import Joi from 'joi';

export const getSchema = Joi.object().keys({
  Key: Joi.string().required(),
  Bucket: Joi.string().required(),
});

export const putSchema = Joi.object().keys({
  Body: Joi.binary().required(),
  Bucket: Joi.string().required(),
  ContentType: Joi.string().required(),
  Key: Joi.string().required(),
});

export const peopleSchema = Joi.array().items(Joi.object().keys({
  name: Joi.string().allow('').label('name'),
  id: Joi.string().guid().required().label('id'),
  userIdentityId: Joi.string().allow('').label('userIdentityId'),
  img_key: Joi.string().required().label('the image that thumbnail is created from'),
  thumbnail: Joi.string().required().label('thumbnail'),
  boundingBox: Joi.object().keys({
    Height: Joi.number(),
    Left: Joi.number(),
    Top: Joi.number(),
    Width: Joi.number(),
  }),
  imageDimensions: Joi.object().keys({
    height: Joi.number(),
    width: Joi.number(),
  }),
  faces: Joi.array().items(Joi.object().keys({
    FaceId: Joi.string().guid().required().label('FaceId in a face object in the people schema'),
    ExternalImageId: Joi.string().guid().required().label('ExternalImageId'),
  })).label('facess array'),
})).label('people array');
