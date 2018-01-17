const express = require('express');
const MongoClient= require('mongodb').MongoClient;
const mongoose = require('mongoose'); // Note: this project was patched with Mongoose only to get around an authentication error specific to mLab.
mongoose.Promise = global.Promise;
let app = express();
// Standard URI format: mongodb://[dbuser:dbpassword@]host:port/dbname, details set in .env
let db_url = 'mongodb://'+process.env.USER+':'+process.env.PASS+'@'+process.env.HOST+':'+process.env.DB_PORT+'/'+process.env.DB;
let urlPattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name and extension
    '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
    '(\\:\\d+)?'+ // port
    '(\\/[-a-z\\d%@_.~+&:]*)*'+ // path
    '(\\?[;&a-z\\d%@_.,~+&:=-]*)?'+ // query string
    '(\\#[-a-z\\d_]*)?$','i'); // fragment locator
    // https://stackoverflow.com/questions/5717093/check-if-a-javascript-string-is-a-url

function createAvailableIdsDocument() {
    let availableIds = [];
    for (var i = 1001; i < 10000; i++) {
        availableIds.push(i);
    }
    availableIds.splice(3101, 1); // Removes the example output ID (4102)
    // -1000 from omitting 0000 - 1000, -1 from zero-indexing.
    let json = {availableIds};
    dbClient.collection('url_shortener_collection').insertOne(json, function(err, res) {
        if (err) console.log(err);
        console.log("Created 'availableIds' document.");
        availableIdsCheck = true;
        startListening()
    });
}
function createUrlsDocument() {
    let urls = {"4102": "https://www.google.com.au/search?q=cats&rlz=2C1ASRM_enAU0536AU0536&source=lnms&tbm=isch"};
    let json = {urls};
    dbClient.collection('url_shortener_collection').insertOne(json, function(err, res) {
        if (err) throw err;
        console.log("Created 'urls' document.");
        urlsCheck = true;
        startListening()
    });
}
let availableIdsCheck = false;
let urlsCheck = false;
function startListening() {
    if (availableIdsCheck && urlsCheck) {
        let listener = app.listen(process.env.PORT || 3000, function () {
          console.log('Good to go! Node listening on port ' + listener.address().port + '.');
        });
    }
}

mongoose.connect(db_url, { useMongoClient: true });
let dbClient = mongoose.connection;
dbClient.on('error', console.error.bind(console, 'Connection error:'));
dbClient.on('open', function() {
    console.log('Connected...');
    dbClient.db.listCollections( { name: 'url_shortener_collection' } ).toArray(function(err, collectionInfo) {
        if (err) console.log(err);
        // Create collection and documents if they do not exist.
        if (collectionInfo[0]) {
            console.log("'url_shortener_collection' exists.");
            dbClient.collection('url_shortener_collection').findOne({urls: {$exists:true}}, function(err, result) {
                if (err) console.log(err);
                if (result === null) {
                    console.log("'urls' document does not exist...");
                    createUrlsDocument();
                } else {
                    console.log("'urls' document exists.")
                    urlsCheck = true;
                    startListening()
                }
            });
            dbClient.collection('url_shortener_collection').findOne({availableIds: {$exists:true}}, function(err, result) {
                if (err) console.log(err);
                if (result === null) {
                    console.log("'availableIds' document does not exist...")
                    createAvailableIdsDocument();
                } else {
                    console.log("'availableIds document' exists.")
                    availableIdsCheck = true;
                    startListening()
                }
            });
        } else {
            console.log("'url_shortener_collection' does not exist...");
            dbClient.createCollection('url_shortener_collection', function(err, result) {
                if (err) console.log(err);
                console.log("Created 'url_shortener_collection'.");
                console.log("'availableIds' document does not exist...");
                createAvailableIdsDocument();
                console.log("'urls' document does not exist...");
                createUrlsDocument();
            });
        }
    });
});

app.use(express.static('public'));
app.get('', function(req, res) {
  res.sendFile(__dirname + '/views/index.html');
});
app.get('/favicon.ico', function(req, res) { // Ignore request for favicon.
    res.status(204);
});

app.use('/', function(req, res)  {
    let query = req.originalUrl.substr(1); // Query portion of URL (without forward slash).
    if (urlPattern.test(query)) {
      // Query is URL. Shorten it.
      // Adds protocol if not specified for correct redirecting.
      let protocolPattern = /^((http|https):\/\/)/;
      if (!protocolPattern.test(query)) {
          query = 'https://' + query;
      }
      // 1. Get availableIds from database.
      dbClient.collection('url_shortener_collection').findOne({availableIds: {$exists:true}}, function(err, result) {
          if (err) console.log(err);
          let availableIds = result.availableIds;
          // 2. Add a random id and the url to urls document.
          let randomId = availableIds[Math.floor(Math.random() * (availableIds.length - 1))]; // Get random index of availableIds document. This will be the short url.
          if (randomId === undefined) {
              // No available ids. Reset availableIds and urls.
              console.log('No available ids, resetting.');
              dbClient.collection('url_shortener_collection').deleteOne({availableIds: {$exists:true}}, function(err, result) {
                  if (err) console.log(err);
                  createAvailableIdsDocument();
              });
              dbClient.collection('url_shortener_collection').deleteOne({urls: {$exists:true}}, function(err, result) {
                  if (err) console.log(err);
                  createUrlsDocument();
              });
              res.json( {"error": 'URL records reset, please try again.'} );
          } else {
              let idField = 'urls.' + randomId;
              let json = {};
              json[idField] = query; // Required format of the dynamic data for the update function.
              dbClient.collection('url_shortener_collection').update({urls: {$exists:true}}, {$set: json}, function(err, result) {
                  if (err) console.log(err);
                  console.log('id:url inserted');
                  // 3. Remove the random id from availableIds.
                  availableIds.splice(availableIds.indexOf(randomId), 1);
                  dbClient.collection('url_shortener_collection').update({availableIds: {$exists:true}}, {availableIds: availableIds}, function(err, result) {
                      if (err) console.log(err);
                      console.log('id removed');
                      // 4. Return the random availableId and url.
                      res.json( {"original_url": query, "shortened_url": 'localhost:3000/' + randomId} ); // https://gregarious-swing.glitch.me/
                  });
              });
          }     
      });   
  } else if (/^\d{4}$/.test(query)) {
      // Query is shortened URL. Redirect to original.
      // 1. Get urls from database.
      dbClient.collection('url_shortener_collection').findOne({urls: {$exists:true}}, function(err, result) {
          if (err) console.log(err);
          let urls = result.urls;
          // 2. Check if shortened URL record exists.
          if (urls.hasOwnProperty(query)) {
              // 3. Redirect to original URL.
              res.redirect(urls[query]);
          } else {
              res.json( {"error": 'No record exists for this shortened URL.'} );
          }
      });
    } else {
        res.json( {"error": 'Invalid URL.'} );
    }
});

process.on('SIGTERM', function() {
   dbClient.close();
});