import {
  Callback,
  Context,
  S3Event,
  S3EventRecord,
} from "aws-lambda";
import { S3 } from "aws-sdk";
import { InvocationRequest } from "aws-sdk/clients/lambda";
import { GetObjectOutput } from "aws-sdk/clients/s3";
import * as ExifReader from "exifreader";
import { v4 as uuidv4 } from "uuid";
import * as uuidv5 from "uuid/v5";

import getS3Bucket from "./common/getS3Bucket";
import { getTraceMeta } from "./common/getTraceMeta";
import { failure, success } from "./common/responses";
import { safeLength } from "./create";
import { GetObjectError } from "./errors/getObject";
import { INVOCATION_EVENT } from "./lib/constants";
import lambda from "./lib/lambda";
import logger from "./lib/logger";
import createS3Client from "./lib/s3";
import {
  ICreateBody, ILoggerBaseParams, IPathParameters, ITraceMeta, IUpdateBody,
} from "./types";

let s3: S3;

export const S3_EVENT_MATCHER_CREATED = "ObjectCreated";
export const S3_EVENT_MATCHER_REMOVED = "ObjectRemoved";

export function getObject(key): Promise<GetObjectOutput> {
  return s3.getObject({
    Bucket: getS3Bucket(),
    Key: key,
  }).promise()
    .catch((e) => {
      throw new GetObjectError(e, key, process.env.S3_BUCKET);
    });
}

export function parseUserIdentityIdFromKey(key) {
  return key.split("/")[1];
}

export function parseUsernameFromKey(key) {
  return key.split("/")[2];
}

export async function getImageBody(record: S3EventRecord): Promise<ICreateBody> {
  // tslint:disable-next-line:variable-name
  const key = record.s3.object.key;
  const userIdentityId = parseUserIdentityIdFromKey(key);
  const username = parseUsernameFromKey(key);
  const s3Object = await getObject(key);
  const imageMetaData = ExifReader.load(s3Object.Body as Buffer);

  return {
    birthtime: Date.now(),
    img_key: key,
    meta: {
      height: imageMetaData.ImageLength.value,
      tags: imageMetaData,
      width: imageMetaData.ImageWidth.value,
    },
    userIdentityId,
    username,
  };
}

export function getInvokeCreateRequest(
  imageBody: ICreateBody,
  traceMeta: ITraceMeta,
): InvocationRequest {
  const bodyWithMeta: ICreateBody = {
    ...imageBody,
    traceMeta,
  };
  return {
    FunctionName: `${process.env.LAMBDA_PREFIX}create`,
    InvocationType: INVOCATION_EVENT,
    LogType: "Tail",
    Payload: JSON.stringify({
      body: JSON.stringify(bodyWithMeta),
    }),
  };
}

export function getInvokeDeleteRequest(
  record: S3EventRecord,
  traceMeta: ITraceMeta,
): InvocationRequest {
    const bodyWithMeta: IUpdateBody = {
      traceMeta,
    };
    const pathParameters: IPathParameters = {
      id: uuidv5(record.s3.object.key, uuidv5.DNS),
      username: parseUsernameFromKey(record.s3.object.key),
    };
    return {
      FunctionName: `${process.env.LAMBDA_PREFIX}delete`,
      InvocationType: INVOCATION_EVENT,
      LogType: "Tail",
      Payload: JSON.stringify({
        body: JSON.stringify(bodyWithMeta),
        pathParameters,
      }),
    };
  }

export async function getInvocations(records: S3EventRecord[], traceMeta) {
  return Promise.all(records.map(async (record) => {
    if (record.eventName.indexOf(S3_EVENT_MATCHER_CREATED)) {
      const imageBody = await getImageBody(record);
      return getInvokeCreateRequest(imageBody, traceMeta);
    } else if (record.eventName.indexOf(S3_EVENT_MATCHER_REMOVED)) {
      return getInvokeDeleteRequest(record, traceMeta);
    }
  }));
}

export function removeCreateRecordsIfDeletePresent(records: S3EventRecord[]) {
  const deleteRecordsByKey = records.filter((record) => {
    return record.eventName.indexOf(S3_EVENT_MATCHER_REMOVED);
  }).map((record) => record.s3.object.key);
  return records.filter((record) => {
    return record.eventName.indexOf(S3_EVENT_MATCHER_REMOVED) ||
      (
        record.eventName.indexOf(S3_EVENT_MATCHER_CREATED)
        && !deleteRecordsByKey.includes(record.s3.object.key)
      );
  });
}

export function invokeLambdas(invocations) {
  return Promise.all(invocations.map((invocation) => lambda.invoke(invocation).promise()));
}

export function getLogFields(records: S3EventRecord[], recordsToInvoke?, invocations?) {
  return {
    invocationsCount: safeLength(invocations),
    recordsCount: safeLength(records),
    recordsToInvokeCount: safeLength(recordsToInvoke),
  };
}

export async function handler(event: S3Event, context: Context, callback: Callback) {
  const startTime: number = Date.now();
  const loggerBaseParams: ILoggerBaseParams = {
    id: uuidv4(),
    name: "fotoEvents",
    parentId: "",
    startTime,
    traceId: uuidv4(),
  };
  const traceMeta = getTraceMeta(loggerBaseParams);
  s3 = createS3Client();
  try {
    const recordsToInvoke = removeCreateRecordsIfDeletePresent(event.Records);
    const invocations = await getInvocations(recordsToInvoke, traceMeta);
    invokeLambdas(invocations);
    logger(context, loggerBaseParams, getLogFields(event.Records, recordsToInvoke, invocations ));
    return callback(null, success(true));
  } catch (err) {
    logger(context, loggerBaseParams, { err, ...getLogFields(event.Records) });
    return callback(null, failure(err));
  }
}
