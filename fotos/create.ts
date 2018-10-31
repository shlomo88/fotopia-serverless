
import { AttributeValue as ddbAttVals } from "dynamodb-data-types";
import * as uuid from "uuid";
import { INVOCATION_REQUEST_RESPONSE } from "./lib/constants";
import dynamodb from "./lib/dynamodb";
import lambda from "./lib/lambda";
import logger from "./lib/logger";
import rekognition from "./lib/rekognition";
import { failure, success } from "./lib/responses";

const fotopiaGroup = process.env.FOTOPIA_GROUP;
export const THUMB_SUFFIX = "-thumbnail";

export function replicateAuthKey(imgKey, userIdentityId) {
  return process.env.IS_OFFLINE ?
    imgKey :
    `protected/${userIdentityId}/${imgKey}`;
}

export function safeLength(arr) {
  return Array.isArray(arr) ? arr.length : 0;
}

export function getTagsFromRekognitionLabels(labels) {
  return labels && labels.Labels && Array.isArray(labels.Labels) ?
    labels.Labels.map((label) => label.Name) :
    [];
}

export function getLogFields(request, dbItem, faces, labels) {
  return {
    createIdentifiedFacesCount: safeLength(faces),
    createIdentifiedLabelsCount: safeLength(getTagsFromRekognitionLabels(labels)),
    createPayloadTagCount: safeLength(request.tags),
    imageBirthtime: dbItem && dbItem.birthtime || request.birthtime,
    imageCreatedAt: dbItem && dbItem.createdAt,
    imageFacesCount: safeLength(dbItem.faces),
    imageFamilyGroup: fotopiaGroup,
    imageHeight: request.meta && request.meta.height,
    imageId: dbItem && dbItem.id,
    imageKey: request.img_key,
    imageTagCount: safeLength(dbItem.tags),
    imageUpdatedAt: dbItem && dbItem.updatedAt,
    imageUserIdentityId: request.userIdentityId,
    imageUsername: request.username,
    imageWidth: request.meta && request.meta.width,
  };
}

export function validateRequest(data) {
  return data;
}

export function createThumbKey(key) {
  const keySplit = key.split(".");
  const ext = keySplit[keySplit.length - 1];
  return `${key.substr(0, key.lastIndexOf(ext) - 1)}${THUMB_SUFFIX}.${ext}`;
}

export function getInvokeThumbnailsParams(data) {
  const authKey = replicateAuthKey(data.img_key, data.userIdentityId);
  return {
    FunctionName: process.env.IS_OFFLINE ? "thumbs" : `${process.env.LAMBDA_PREFIX}thumbs`,
    InvocationType: INVOCATION_REQUEST_RESPONSE,
    LogType: "Tail",
    Payload: JSON.stringify({
      body: JSON.stringify({
        key: authKey,
        thumbKey: createThumbKey(authKey),
      }),
    }),
  };
}
export function getPeopleFromRekognitionFaces(faces) {
  return faces && faces.FaceRecords && Array.isArray(faces.FaceRecords) ?
    faces.FaceRecords.map((faceRecord) => faceRecord.Face.FaceId) :
    [];
}

export function getDynamoDbParams(data, id, group, faces, labels) {
  const timestamp = new Date().getTime();

  const tags = [...data.tags, ...getTagsFromRekognitionLabels(labels)];

  return {
    Item: {
      birthtime: new Date(data.birthtime).getTime(),
      createdAt: timestamp,
      faces: (faces || []), // prob null from rekognition error, hack for now
      group,
      id,
      img_key: data.img_key, // s3 object key
      img_thumb_key: createThumbKey(data.img_key),
      meta: data.meta, // whatever metadata we've got for this item
      people: [],
      tags,
      updatedAt: timestamp,
      userIdentityId: data.userIdentityId,
      username: data.username,
    },
    TableName: process.env.DYNAMODB_TABLE || "",
  };
}

export function logRekognitionError(e, data, id, indexFacesParams, context, startTime) {
  if (e.code && e.code === "ResourceNotFoundException") {
    const params = {
      CollectionId: fotopiaGroup,
    };
    return rekognition.createCollection(params)
      .promise()
      // eslint-disable-next-line
      .then(() => getRekognitionFaceData(data, id, context, startTime));
  }
  if (e.code && e.code === "InvalidS3ObjectException") {
    logger(context, startTime, { err: e, ...getLogFields(data, { id }, [], []) });
  } else {
    logger(context, startTime, { err: {e, code: "logRekognitionError"} });
  }
  return null;
}

export function getRekognitionFaceData(data, id, context, startTime) {
  const params = {
    CollectionId: fotopiaGroup,
    DetectionAttributes: [
    ],
    ExternalImageId: id,
    Image: {
      S3Object: {
        Bucket: process.env.S3_BUCKET,
        Name: replicateAuthKey(data.img_key, data.userIdentityId),
      },
    },
  };
  return rekognition ?
    rekognition.indexFaces(params)
      .promise()
      .then((response) => response.FaceRecords)
      .catch((e) => logRekognitionError(e, data, id, params, context, startTime)) :
    [];
  // sometimes getting a object not found error - img
  // should be avail as create happens after upload is complete
  // perhaps everything should be evented?
}

export function getRekognitionLabelData(data) {
  const params = {
    Image: {
      S3Object: {
        Bucket: process.env.S3_BUCKET,
        Name: replicateAuthKey(data.img_key, data.userIdentityId),
      },
    },
    MaxLabels: 30,
    MinConfidence: 80,
  };
  return rekognition ?
    rekognition.detectLabels(params)
      .promise() :
    [];
}

export function getInvokeParams(ddbParams, name) {
  return {
    FunctionName: name,
    InvocationType: INVOCATION_REQUEST_RESPONSE,
    LogType: "Tail",
    Payload: JSON.stringify({
      Records: [
        {
          dynamodb: {
            Keys: {
              id: {
                S: ddbParams.Item.id,
              },
              username: {
                S: ddbParams.Item.username,
              },
            },
            NewImage: ddbAttVals.wrap(ddbParams.Item),
          },
        },
      ],
    }),
  };
}

export async function createItem(event, context, callback) {
  const startTime = Date.now();
  const id = uuid.v1();
  const data = JSON.parse(event.body);
  try {
    const request = validateRequest(data);
    const invokeParams = getInvokeThumbnailsParams(request);
    const thumbPromise = lambda.invoke(invokeParams).promise();
    const facesPromise = getRekognitionFaceData(request, id, context, startTime);
    const labelsPromise = getRekognitionLabelData(request);

    await thumbPromise;
    const faces = await facesPromise;
    const labels = await labelsPromise;

    const ddbParams = getDynamoDbParams(request, id, fotopiaGroup, faces, labels);
    await dynamodb.put(ddbParams).promise();
    if (process.env.IS_OFFLINE) {
      const streamParams = getInvokeParams(ddbParams, "stream");
      const streamPromise = lambda.invoke(streamParams).promise();
      const facesParams = getInvokeParams(ddbParams, "faces");
      const facesLambdaPromise = lambda.invoke(facesParams).promise();
      await streamPromise;
      await facesLambdaPromise;
    }
    logger(context, startTime, getLogFields(request, ddbParams.Item, faces, labels));
    return callback(null, success(ddbParams.Item));
  } catch (err) {
    logger(context, startTime, { err, ...getLogFields(data, { id }, [], []) });
    return callback(null, failure(err));
  }
}