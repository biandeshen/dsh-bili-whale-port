import fs from 'node:fs'
globalThis.fetch = async (url, opts = {}) => {
  fs.appendFileSync(process.env.TEST_REQUESTS, JSON.stringify({url:String(url),method:opts.method ?? 'GET'})+'\n')
  let data
  if (String(url).includes('/x/v2/reply/reply')) {
    const u = new URL(url)
    data = u.searchParams.get('type') === '11' && u.searchParams.get('root') === '9'
      ? { code: 0, data: { replies: [], root: { rpid: 9, mid: 222, member: { uname: 'Owner' } } } }
      : { code: -404 }
    return new Response(JSON.stringify(data), {status:200})
  }
  if (process.env.TEST_DM_FILE && String(url).includes('/fetch_session_msgs')) {
    const last = JSON.parse(fs.readFileSync(process.env.TEST_DM_FILE, 'utf8'))
    data = { code: 0, data: { messages: [last], has_more: 0 } }
    return new Response(JSON.stringify(data), {status:200})
  }
  if (process.env.TEST_FEEDS && String(url).includes('/x/msgfeed/')) {
    const feeds=JSON.parse(fs.readFileSync(process.env.TEST_FEEDS,'utf8'))
    const kind=new URL(String(url)).pathname.split('/').pop()
    if(feeds[kind]?.error)throw Error('mock inbox unavailable')
    data={code:0,data:{items:feeds[kind]??[]}}
    return new Response(JSON.stringify(data), {status:200})
  }
  if (String(url).includes('/nav')) data={code:0,data:{isLogin:true,mid:111,uname:'test-account',wbi_img:{img_url:'https://i.example/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i.example/4932caff0ff746eab6f01bf08b70ac45.png'}}}
  else if(String(url).includes('/x/relation'))data={code:0,data:{attribute:6}}
  else if(String(url).includes('/send_msg'))data={code:0,data:{}}
  else if(String(url).includes('web-dynamic/v1/feed/space')&&process.env.TEST_SPACE_FILE){
    // dynamic recent 的夹具：{ pages: { "<offset>": {items,offset,has_more} } }
    const fx=JSON.parse(fs.readFileSync(process.env.TEST_SPACE_FILE,'utf8'))
    const key=new URL(String(url)).searchParams.get('offset')??''
    if(fx.pages[key]===undefined)throw Error('TEST_SPACE_FILE 没有 offset='+key+' 这页')
    data={code:(fx.pages[key].__code ?? 0),data:fx.pages[key]}
  }
  else if((String(url).includes('/x/web-interface/view')||String(url).includes('/x/web-interface/wbi/view'))&&process.env.TEST_VIEW_FILE)data=JSON.parse(fs.readFileSync(process.env.TEST_VIEW_FILE,'utf8'))
  else if(String(url).includes('/x/web-interface/view'))data={code:0,data:{aid:12345,title:'测试视频标题',owner:{name:'测试UP'}}}
  else if(String(url).includes('comment.bilibili.com')&&process.env.TEST_DANMAKU_FILE)return new Response(fs.readFileSync(process.env.TEST_DANMAKU_FILE,'utf8'),{status:200})
  else if(String(url).includes('/x/player/wbi/v2')&&process.env.TEST_PLAYER_FILE)data=JSON.parse(fs.readFileSync(process.env.TEST_PLAYER_FILE,'utf8'))
  else if(String(url).includes('/x/player/wbi/v2'))data={code:0,data:{subtitle:{subtitles:[]}}}
  else if(String(url).includes('wbi/search/type')&&process.env.TEST_SEARCH_FILE)data=JSON.parse(fs.readFileSync(process.env.TEST_SEARCH_FILE,'utf8'))
  else if(String(url).includes('/x/web-interface/archive/like'))data={code:0,data:{}}
  else if(String(url).includes('/x/v3/fav/resource'))data={code:0,data:{}}
  else throw Error('Network blocked by test: '+url)
  return new Response(JSON.stringify(data), {status:200})
}
