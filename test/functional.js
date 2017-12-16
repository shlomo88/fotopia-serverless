
require('es6-promise').polyfill();
require('isomorphic-fetch');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');
const test = require('tape');

const upload = require('./upload');


const bucket = 'fotopia-web-app-prod';
const localhost = "http://localhost:3000/"
const userid = uuid.v1();

const images = [{
  path: path.resolve(__dirname, './mock/one.jpg'),
  key: userid+'-one.jpg'
},{
  path: path.resolve(__dirname, './mock/two.jpeg'),
  key: userid+'-two.jpg'
}];

const records = [{
  "userid":userid,
  "birthtime":"2012-06-28T00:55:11.000Z",
  "tags":["blue","red"],
  "people":["Steve","Oren"]
}, {
  "userid":userid,
  "birthtime":"2014-06-28T00:55:11.000Z",
  "tags":["blue","yellow"],
  "people":["Miki","Oren"]
}];


test('upload image one', (t) => {
  t.plan(2);
  upload(images[0].path, bucket, images[0].key)
    .then((responseBody) => {
      t.equal(responseBody.key, images[0].key);
      t.equal(responseBody.Bucket, bucket);

      records[0].location = responseBody.Location;
    });
});

test('upload image two', (t) => {
  t.plan(2);
  upload(images[1].path, bucket, images[1].key)
    .then((responseBody) => {
      t.equal(responseBody.key, images[1].key);
      t.equal(responseBody.Bucket, bucket);

      records[1].location = responseBody.Location;
    });
});

test('create image one meta data', function (t) {
  t.plan(1);

  fetch(localhost + 'create', {
    method: 'POST',
    body: JSON.stringify(records[0])
  })
    .then((response) => response.json())
    .then((responseBody) => {

      const utcBirthTime = new Date(responseBody.birthtime).toISOString();
      t.equal(utcBirthTime, records[0].birthtime);
    });
});

test('create image two meta data', function (t) {
  t.plan(1);

  fetch(localhost + 'create', {
    method: 'POST',
    body: JSON.stringify(records[1])
  })
    .then((response) => response.json())
    .then((responseBody) => {

      const utcBirthTime = new Date(responseBody.birthtime).toISOString();
      t.equal(utcBirthTime, records[1].birthtime);
    });
});


test('query by tag and person', function (t) {
  t.plan(2);

  const query = {
    "userid":userid,
    "criteria":{
      "tags":["blue"],
      "people":["Miki"]
    },
    "from":"2004-04-04",
    "to":"2017-11-02"
  }

  fetch(localhost + 'query', {
    method: 'POST',
    body: JSON.stringify(query)
  })
    .then((response) => response.json())
    .then((responseBody) => {
      t.equal(responseBody.length, 1);
      const numericBirthTime = new Date(records[1].birthtime).getTime();
      t.equal(responseBody[0].birthtime, numericBirthTime);
    });
});

test('query by tag only', function (t) {
  t.plan(1);

  const query = {
    "userid":userid,
    "criteria":{
      "tags":["blue"]
    },
    "from":"2004-04-04",
    "to":"2017-11-02"
  }

  fetch(localhost + 'query', {
    method: 'POST',
    body: JSON.stringify(query)
  })
    .then((response) => response.json())
    .then((responseBody) => {
      t.equal(responseBody.length, 2);
    });
});

test('query by person only', function (t) {
  t.plan(1);

  const query = {
    "userid":userid,
    "criteria":{
      "people":["Oren"]
    },
    "from":"2004-04-04",
    "to":"2017-11-02"
  }

  fetch(localhost + 'query', {
    method: 'POST',
    body: JSON.stringify(query)
  })
    .then((response) => response.json())
    .then((responseBody) => {
      t.equal(responseBody.length, 2);
    });
});

/*
more tests

get an image record
update a person
update a tag
update metadata

update multiple

delete an image and its record


*/
