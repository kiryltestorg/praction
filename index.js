const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const https = require('https');
const url = require('url');
const {  PutObjectCommand, S3Client } = require('@aws-sdk/client-s3')
const  { Octokit, App } = require("octokit");

var bucketName = core.getInput("bucketName")
var TAR_URL = core.getInput("tarUrl");
var FILE_NAME = core.getInput("fileName")
var path = core.getInput("path")
console.log(path)
let client = new S3Client();

function writeToFile(response) {
  response.pipe(fs.createWriteStream(FILE_NAME));
}var options = {
  host: 'api.github.com',
  path: TAR_URL,
  method: 'GET',
  headers: {'user-agent': 'node.js'}
};
https.get(options, function(response) {
  if (response.statusCode > 300 && response.statusCode < 400 && response.headers.location) {
    if (url.parse(response.headers.location).hostname) {
      https.get(response.headers.location, writeToFile);
    } else {
      https.get(url.resolve(url.parse(TAR_URL).hostname, response.headers.location), writeToFile);
    }
  } else {
    writeToFile(response);
  }
});

var fileStream = fs.createReadStream(FILE_NAME);
var putParams = {
    Bucket: bucketName,
    Key: path,
    Body: fileStream
};
const data =  client.send(new PutObjectCommand(putParams));
