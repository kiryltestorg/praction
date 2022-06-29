async function updateDep(FILE_NAME, tag_name,owner) {
  console.log(FILE_NAME)
  var TAR_URL = 'https://api.github.com/repos/' +owner+ '/' + repo + '/tarball/' + tag_name;

  var path = "Dependencies/" + repo + "/" + FILE_NAME


  var options = {
    host: 'api.github.com',
    path: TAR_URL,
    method: 'GET',
    headers: { 'user-agent': 'node.js' }
  };

  https.get(options, (res) => {

    const writeStream = fs.createWriteStream(FILE_NAME);

    res.pipe(writeStream);

    writeStream.on("finish", function () {
      writeStream.close();
      console.log("The download is Completed");
      var fileStream = fs.createReadStream(FILE_NAME);
      var putParams = {
        Bucket: bucketName,
        Key: path,
        Body: fileStream
      };
      const data = client.send(new PutObjectCommand(putParams));

    });
  });

}
async function list(path) {
  var params = {
    Bucket: bucketName,
    Prefix: path + "/",
  };
  
  const data = await client.send(new ListObjectsCommand(params));
  if (data.length < 0) {
    return data
  }
  var files = data.Contents?.filter((file) => { return file.Key.indexOf('.gz') > 0 }).sort((file1, file2) => -1 * file1.Key.localeCompare(file2.Key))
  return files
}
async function getLatest(repo,owner) {
  var latest = await octokit.request('GET /repos/{owner}/{repo}/releases/latest', {
    owner: owner,
    repo: repo
  }

  )
  return latest
}

function compareVersions(v1, v2) {
  let v1_split = v1.split(".")
  let v2_split = v2.split(".")
  if (v1_split.length == v2_split.length) {
    for (let i = 0; i < v1_split.length; i++) {
      if (v1_split[i] > v2_split[i]) {
        return 1
      }
      if (v1_split[i] < v2_split[i]) {
        return -1
      }
    }
    return 0
  }
  else {
    return 0
  }
}

function getConfig(repo){
  var depPath = core.getInput("depPath")
  var fs = require('fs');
  var config = JSON.parse(fs.readFileSync(depPath, 'utf8'));
  return config[repo];

}
function parseConfig(cfg){
  var path = cfg["path"]
  var url = cfg["github_url"]
  var org = url.split("/")[0]
  return [path,org]
}

async function syncDependencies(repo) {
  var cfg = getConfig(repo)
  var path_and_org = parseConfig(cfg)
  var owner = path_and_org[1]
  var path = path_and_org[0]

  var s3_dep_list = await list(repo,path)
  var gh_latest_release = await getLatest(repo,owner)

  var g_tag = gh_latest_release.data.tag_name.replace("v", "")
  if (!s3_dep_list) {
    updateDep(repo + "-" + g_tag + ".tar.gz", g_tag,owner)
    return
  }

  var s3_latest = s3_dep_list[0]
  var s3_latest_tag = s3_latest.Key.substring(s3_latest.Key.indexOf('-') + 1, s3_latest.Key.indexOf(".tar"))
  console.log(s3_latest_tag)
  console.log(g_tag)


  if (compareVersions(g_tag, s3_latest_tag)) {
    updateDep(repo + "-" + g_tag + ".tar.gz", g_tag,owner)
  }

}

repo_list.forEach(element => {
  syncDependencies(element)
});
