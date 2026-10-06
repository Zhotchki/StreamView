const JSON_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"};
const textHeaders={"Cache-Control":"no-store","Access-Control-Allow-Origin":"*"};
const sports=new Set(["football/nfl","football/college-football","baseball/mlb","basketball/nba","basketball/mens-college-basketball","hockey/nhl","soccer/usa.1","soccer/eng.1","golf/pga","mma/ufc"]);

const b64u=(bytes)=>{let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")};
const b64ud=(s)=>{s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";const bin=atob(s);return Uint8Array.from(bin,c=>c.charCodeAt(0))};
const enc=new TextEncoder();
async function keyFor(secret){return crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"])}
async function makeToken(target,secret){const payload=b64u(enc.encode(JSON.stringify({u:target,e:Date.now()+4*60*60*1000})));const sig=b64u(new Uint8Array(await crypto.subtle.sign("HMAC",await keyFor(secret),enc.encode(payload))));return payload+"."+sig}
async function readToken(token,secret){const [payload,sig]=String(token||"").split(".");if(!payload||!sig)return null;try{const ok=await crypto.subtle.verify("HMAC",await keyFor(secret),b64ud(sig),enc.encode(payload));if(!ok)return null;const p=JSON.parse(new TextDecoder().decode(b64ud(payload)));if(!p?.u||!p?.e||Date.now()>Number(p.e))return null;const u=new URL(p.u);if(u.protocol!=="https:")return null;return u.toString()}catch{return null}}
function json(status,obj,extra={}){return new Response(JSON.stringify(obj),{status,headers:{...JSON_HEADERS,...extra}})}
function cors(status,body,type="text/plain; charset=utf-8"){return new Response(body,{status,headers:{"Content-Type":type,...textHeaders}})}
async function bodyText(request,max=200000){const text=await request.text();if(text.length>max)throw new Error("too large");return text}
function safeTarget(raw,allowHost){const u=new URL(raw);if(u.protocol!=="https:")throw new Error("HTTPS required");if(allowHost && !(u.hostname==="uzzu.tv"||u.hostname.endsWith(".uzzu.tv")))throw new Error("Not allowed");return u}
function relayPath(token){return "/api/relay?token="+encodeURIComponent(token)}

async function rewriteManifest(text,base,secret){
  const lines=text.split(/\r?\n/),out=[];
  for(const line of lines){
    const x=line.trim();
    if(!x){out.push(line);continue}
    if(x.startsWith("#")){
      let z=line;
      const matches=[...line.matchAll(/URI=(["'])(.*?)\1/g)];
      for(const m of matches){
        try{const abs=new URL(m[2],base).toString();const tok=await makeToken(abs,secret);z=z.replace(m[0],"URI="+m[1]+relayPath(tok)+m[1])}catch{}
      }
      out.push(z);
    }else{
      try{const abs=new URL(x,base).toString();const tok=await makeToken(abs,secret);out.push(relayPath(tok))}
      catch{out.push(line)}
    }
  }
  return out.join("\n")
}

async function playlist(request){
  if(request.method!=="POST")return cors(405,"Method not allowed");
  let data;try{data=JSON.parse(await bodyText(request,8192)||"{}")}catch{return cors(400,"Bad request")}
  let target;try{target=safeTarget(data.url,true)}catch(e){return cors(400,e.message)}
  try{
    const r=await fetch(target.toString(),{redirect:"follow",headers:{Accept:"*/*","User-Agent":"Mozilla/5.0 StreamView/Cloudflare"}});
    const headers=new Headers(textHeaders);headers.set("Content-Type",r.headers.get("content-type")||"text/plain; charset=utf-8");
    return new Response(r.body,{status:r.status,headers});
  }catch(e){return cors(502,"Playlist upstream unavailable")}
}

async function relaySession(request,env){
  if(request.method!=="POST")return cors(405,"Method not allowed");
  let data;try{data=JSON.parse(await bodyText(request,8192)||"{}")}catch{return cors(400,"Bad request")}
  let target;try{target=safeTarget(data.url)}catch(e){return cors(400,e.message)}
  const token=await makeToken(target.toString(),env.RELAY_SECRET);
  return json(200,{url:relayPath(token)});
}

async function relay(request,env){
  const target=await readToken(new URL(request.url).searchParams.get("token"),env.RELAY_SECRET);
  if(!target)return cors(403,"Relay expired or invalid");
  const headers=new Headers({"Accept":"*/*","User-Agent":"Mozilla/5.0 StreamView/Cloudflare"});
  const range=request.headers.get("Range");if(range)headers.set("Range",range);
  try{
    const r=await fetch(target,{headers,redirect:"follow"});
    const ct=r.headers.get("content-type")||"";
    const finalUrl=r.url||target;
    const isList=/mpegurl/i.test(ct)||new URL(finalUrl).pathname.toLowerCase().endsWith(".m3u8");
    if(isList){
      const body=await r.text();
      const out=await rewriteManifest(body,finalUrl,env.RELAY_SECRET);
      const h=new Headers(textHeaders);h.set("Content-Type","application/vnd.apple.mpegurl");
      return new Response(out,{status:r.status,headers:h});
    }
    const h=new Headers(textHeaders);
    for(const k of ["Content-Type","Content-Length","Content-Range","Accept-Ranges","ETag","Last-Modified"])if(r.headers.get(k))h.set(k,r.headers.get(k));
    return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h});
  }catch(e){return cors(502,"Relay upstream unavailable")}
}

async function epg(request){
  const target=new URL(request.url).searchParams.get("url")||"";
  let u;try{u=safeTarget(target)}catch(e){return cors(400,e.message)}
  try{
    const r=await fetch(u.toString(),{headers:{Accept:"application/xml,text/xml,*/*","User-Agent":"Mozilla/5.0 StreamView/Cloudflare"}});
    return new Response(r.body,{status:r.status,headers:{"Content-Type":r.headers.get("content-type")||"application/xml; charset=utf-8",...textHeaders}});
  }catch{return cors(502,"EPG upstream unavailable")}
}

async function epgFallback(request){
  if(request.method!=="POST")return cors(405,"Method not allowed");
  let data;try{data=JSON.parse(await bodyText(request,200000)||"{}")}catch{return cors(400,"Bad JSON")}
  const reqs=Array.isArray(data.channels)?data.channels:[];
  const tvgMap={"nbatv.us":"9200000070","cartoonnetwork.us":"9200004848","aande.us":"9200004889","nickelodeon.us":"9200006939","foxbusiness.us":"9200009124","trutv.us":"9200009547","espn2.us":"9200012351","accnetwork.us":"9200017734","tennischannel.us":"9200017917","animalplanet.us":"9200018479","discoveryscience.us":"9200019847","tbs.us":"9233000403","foxnews.us":"9233000410","hgtv.us":"9233004104","nhlnetwork.us":"9233009455","secnetwork.us":"9233008517","weatherchannel.us":"9233013815","espnu.us":"9233011350"};
  const norm=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
  const canon=x=>norm(x).replace(/^(the )/,"").replace(/\b(usa|us|hd|eastern|east|western|west|feed|channel)\b/g," ").replace(/\s+/g," ").trim();
  const now=Date.now(),start=Math.floor(now/1000)-7200;
  try{
    const rr=await fetch("https://backend.tvguide.com/tvschedules/tvguide/9100001138/web?start="+start+"&duration=240",{headers:{referer:"https://www.tvguide.com/","User-Agent":"Mozilla/5.0 StreamView/Cloudflare",Accept:"application/json"}});
    const j=rr.ok?await rr.json():{data:{}},items=j?.data?.items||[],out=[],foundChannels=[],candidates=[],seen=new Set();
    for(const q of reqs){
      const rid=String(q.tvgId||"").toLowerCase(),sid=tvgMap[rid]||"",qc=canon(q.name||q.tvgName||"");
      const item=items.find(x=>sid&&String(x?.channel?.sourceId||"")===sid)||items.find(x=>qc&&canon(x?.channel?.fullName||x?.channel?.name||"")===qc);
      if(!item)continue;
      const gid=String(item.channel?.sourceId||"tvguide"),gname=item.channel?.fullName||item.channel?.name||q.name||"";
      foundChannels.push({requested:q.name||q.tvgName||"",requestedId:q.tvgId||"",guideId:"tvguide:"+gid,guideName:gname});
      for(const p of (item.programSchedules||[])){
        const a1=Number(p.startTime||0)*1000,a2=Number(p.endTime||0)*1000;
        if(a1<=now&&now<a2){
          const title=String(p.title||p.episodeTitle||"").trim();
          if(title&&!seen.has("tvguide|"+gid+"|"+title)){seen.add("tvguide|"+gid+"|"+title);out.push({id:"tvguide:"+gid,name:q.name||q.tvgName||gname,title})}
          break;
        }
      }
    }
    return json(200,{channels:out,sources:rr.ok?1:0,candidates,foundChannels,sourceStats:[{source:"tvguide.com-direct",http:rr.status,channels:items.length,requestedPrograms:reqs.length,currentPrograms:out.length}]});
  }catch(e){return json(200,{channels:[],sources:0,candidates:[],foundChannels:[],sourceStats:[{source:"tvguide.com-direct",http:0,error:e.message}]})}
}

async function schedule(request){
  const q=new URL(request.url).searchParams,sport=q.get("sport")||"",dates=q.get("dates")||"";
  if(!sports.has(sport)||!/^[0-9]{8}-[0-9]{8}$/.test(dates))return json(400,{error:"bad request"});
  try{
    const fmtDay=d=>d.toISOString().slice(0,10).replace(/-/g,"");
    if(sport==="baseball/mlb"){
      const a=dates.slice(0,8),b=dates.slice(9),iso=x=>x.slice(0,4)+"-"+x.slice(4,6)+"-"+x.slice(6,8);
      const r=await fetch("https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate="+iso(a)+"&endDate="+iso(b)+"&hydrate=team",{headers:{Accept:"application/json"}});
      if(!r.ok)return json(502,{error:"MLB schedule upstream "+r.status});
      const j=await r.json(),events=[];
      for(const d of (j.dates||[]))for(const g of (d.games||[])){
        const away=g.teams?.away?.team||{},home=g.teams?.home?.team||{},state=g.status?.abstractGameState==="Live"?"in":g.status?.abstractGameState==="Final"?"post":"pre";
        events.push({date:g.gameDate,status:{type:{state}},competitions:[{status:{type:{state}},competitors:[{team:{name:away.teamName||away.name,shortDisplayName:away.teamName||away.name,displayName:away.name,abbreviation:away.abbreviation,location:away.locationName}},{team:{name:home.teamName||home.name,shortDisplayName:home.teamName||home.name,displayName:home.name,abbreviation:home.abbreviation,location:home.locationName}}]}]});
      }
      return json(200,{events});
    }
    let d=new Date(dates.slice(0,4)+"-"+dates.slice(4,6)+"-"+dates.slice(6,8)+"T12:00:00Z"),end=new Date(dates.slice(9,13)+"-"+dates.slice(13,15)+"-"+dates.slice(15,17)+"T12:00:00Z"),days=[];
    while(d<=end&&days.length<12){days.push(fmtDay(d));d=new Date(d.getTime()+86400000)}
    const results=await Promise.all(days.map(async day=>{try{const r=await fetch("https://site.api.espn.com/apis/site/v2/sports/"+sport+"/scoreboard?limit=200&dates="+day,{headers:{Accept:"application/json"}});return r.ok?await r.json():{events:[]}}catch{return {events:[]}}}));
    const events=[],seen=new Set();
    for(const j of results)for(const e of (j.events||[])){const key=e.id||sport+"|"+e.date;if(!seen.has(key)){seen.add(key);events.push(e)}}
    return json(200,{events});
  }catch{return json(502,{error:"Schedule upstream unavailable"})}
}

export default {
  async fetch(request,env){
    const p=new URL(request.url).pathname;
    try{
      if(p==="/api/playlist")return playlist(request);
      if(p==="/api/relay/session")return relaySession(request,env);
      if(p==="/api/relay")return relay(request,env);
      if(p==="/api/epg")return epg(request);
      if(p==="/api/epg-fallback")return epgFallback(request);
      if(p==="/api/schedule")return schedule(request);
      if(p==="/api/diagnostic")return request.method==="GET"?json(200,{message:"Cloudflare worker diagnostic endpoint active."}):new Response(null,{status:204});
      return env.ASSETS.fetch(request);
    }catch(e){return cors(500,"Server error")}
  }
};