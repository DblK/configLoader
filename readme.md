# Config Loader (CICP Plugin)

This CICP plugin allows you to dynamically change the configuration of the any other plugins by sending query to any domain with some specific headers.  

# How to use it

## Other plugins dependencies

This plugin depends on:
- [@dblk/autopilot](https://github.com/dblk/autopilot)
- [@dblk/recorder](https://github.com/dblk/recorder)

## Add it to CICP

Install it to your `plugins` folder, then do not forget to add it while launching the cli: `cicp -o autopilot,configLoader,recorder`.   
This plugin must be _after_ autopilot _and before_ recorder.

## Require this plugin from another

Simply add the following object in your `package.json`:

```json
"plugin": {
  "consumes": [
    "configLoader",
  ],
}
```

## Autopilot registered commands

This plugin register some command to allow to change dynamically its configuration through the following headers:

- X-DBLK-CICP-RECORD recordset
    - Launch a record 
- X-DBLK-CICP-RECORD-END recordset 
    - End the record (Save to disk)
- X-DBLK-CICP-REPLAY-FILE recordset  
    - Replay a recordset, fails if it does not found it
- X-DBLK-CICP-REPLAY-FILE-OR-RECORD recordset  
    - Replay a recordset, records if it does not found it
- X-DBLK-CICP-LOAD-ALL
    - Load every config folder in memory for fast use and concurrent test response
- X-DBLK-CICP-RECORD-SET
    - Specify the current recordset in which the query should look into

## Amend the config

From another plugin you can amend the config by calling the function `defaultPluginConfig`.

__Arguments__

* object:
  * plugin (String) - Name of the plugin
  * data (Any) - The default configuration for this plugin

This function is useful to set a global configuration for each requests.  
In addition to that, you can inside each request object, add a different value from general settings.

For example, with the [@dblk/recorder](https://github.com/dblk/recorder) plugin, you can specify a `speed` value to `original` to replay with the original delay.

# Additional Informations

This plugin will emit the event `NEW_SET` once it has finished to load a recordset and amend it with the default configuration.  
This module use `DEBUG` so feel free to add `DEBUG=cicp:configLoader` to see debug logs.

# License

```
Copyright (c) 2019 Rémy Boulanouar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:



The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.



THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```