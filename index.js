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

var options = {
  host: 'api.github.com',
  path: TAR_URL,
  method: 'GET',
  headers: {'user-agent': 'node.js'}
};

https.get(options, (res) => {
 
  const writeStream = fs.createWriteStream(FILE_NAME);
 
  res.pipe(writeStream);
 
  writeStream.on("end", function() {
    writeStream.close();
    console.log("The download is Completed");
    var fileStream = fs.createReadStream("repoA-0.1.4.tar.gz");
    var putParams = {
    Bucket: bucketName,
    Key: path,
    Body: fileStream
};
const data =  client.send(new PutObjectCommand(putParams));
    
  });
});




