        启动指令 node cf-browser 
        node cf-yujian.js https://dzpmanometry.cn/ 60 32 60 proxy.txt desktop --puppeteer true --redirect true --ratelimit true --query true --卡密 8lA3bi7RlnM5bU2k
        --redirect      true/false   ~ Enable redirect system
        --ratelimit     true/false   ~ Enable ratelimit system
        --query         true/false   ~ Enable random queries
        --useragent     true/false   ~ Specify custom useragent
        --cookie        true/false   ~ Specify custom cookie
        --puppeteer     true/false   ~ Attempt to fetch cf_clearance via Puppeteer
        本脚本低速率绕httpddos，过高级托管，UAM，js质询，自动筛选代理

        请把卡密验证部分逻辑删除，不然代码会在验证代理的时候终止。
        因为我的服务器过期了，无法验证你的卡密是不是有效的
        安装依赖 
        npm install axios chalk colors crypto fs http http2 https puppeteer puppeteer-extra puppeteer-extra-plugin-stealth tls url
        🟩 推荐 Node.js 版本： ≥ v16.0.0
        🟨 最低可用版本： ≥ v14.17.0（长期支持 LTS）

![微信图片_20250123101806](https://github.com/user-attachments/assets/0d9c06ac-2189-4df7-ab93-b383e0bf6f42)
