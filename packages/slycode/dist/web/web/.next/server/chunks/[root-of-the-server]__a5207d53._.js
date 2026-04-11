module.exports=[18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},14747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},46786,(e,t,r)=>{t.exports=e.x("os",()=>require("os"))},22734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},15801,e=>{"use strict";var t=e.i(14747),r=e.i(22734),a=e.i(46786);function n(e){return(e=e.replace(/^[\u02dc\uff5e]/,"~")).startsWith("~/")||"~"===e?e.replace(/^~/,a.default.homedir()):e}function s(){if(process.env.SLYCODE_HOME)return process.env.SLYCODE_HOME;let e=process.cwd();return(console.warn("[paths] SLYCODE_HOME not set in production — falling back to cwd:",e),e.endsWith("/web")||e.endsWith("\\web"))?t.default.dirname(e):e}function i(){let e=s(),a=t.default.join(e,"node_modules","@slycode","slycode","dist");return r.default.existsSync(a)?a:e}function o(){return process.env.BRIDGE_URL?process.env.BRIDGE_URL:"http://127.0.0.1:3004"}e.s(["expandTilde",()=>n,"getBridgeUrl",()=>o,"getPackageDir",()=>i,"getSlycodeRoot",()=>s])},77649,e=>{"use strict";var t=e.i(98490),r=e.i(18006),a=e.i(95912),n=e.i(72560),s=e.i(76852),i=e.i(38533),o=e.i(55822),d=e.i(54068),l=e.i(66843),c=e.i(99385),u=e.i(3050),p=e.i(75293),h=e.i(2144),m=e.i(33599),f=e.i(36497),v=e.i(93695);e.i(79178);var g=e.i(96717),x=e.i(23480),y=e.i(22734),R=e.i(14747),C=e.i(15801);async function w(e){try{var t,r,a,n,s,i,o,d,l,c,u,p,h,m,f,v,g,w;let E,$,b,{mode:k,provider:P,assetType:T,assetName:A,description:S,changes:N}=await e.json();if(!k||!P||!T)return x.NextResponse.json({error:"mode, provider, and assetType are required"},{status:400});if("create"===k&&(!A||!S))return x.NextResponse.json({error:"assetName and description are required for create mode"},{status:400});if("modify"===k&&!A)return x.NextResponse.json({error:"assetName is required for modify mode"},{status:400});let M=(0,C.getSlycodeRoot)();if("mcp"===T)$=R.default.join(M,`store/mcp/${A}.json`);else{let e="skill"===T?"skills":"agents",t="skill"===T?`store/${e}/${A}/SKILL.md`:`store/${e}/${A}.md`;$=R.default.join(M,t)}let O=R.default.join(M,"documentation","reference","ai_cli_providers.md");if("modify"===k&&!y.default.existsSync($)){if("mcp"===T)return x.NextResponse.json({error:`Could not find MCP config '${A}' at ${$}`},{status:404});if("skill"!==T)return x.NextResponse.json({error:`Could not find asset '${A}' in store at ${$}`},{status:404})}return b="mcp"===T?"create"===k?(t=A,r=S,a=$,`Create an MCP (Model Context Protocol) server configuration called "${t}".

**Output file:** \`${a}\`

## What this MCP server should do
${r}

## Research steps

1. Research the MCP server package described above — find the correct npm package name, command, and required arguments
2. Check if there are any required environment variables or setup steps
3. Determine whether this is a stdio MCP (runs locally via command) or HTTP MCP (connects to a URL)

## Store JSON format

There are two transport types. Use the one that matches the MCP server:

### Stdio MCP (runs a local process)
\`\`\`json
{
  "name": "${t}",
  "command": "<executable, e.g. npx, node, python>",
  "args": ["<arguments to launch the MCP server>"],
  "env": {
    "API_KEY": "\${API_KEY}"
  },
  "description": "<concise one-line description>",
  "version": "1.0.0",
  "updated": "<today's date, YYYY-MM-DD>"
}
\`\`\`

### HTTP MCP (connects to a remote URL)
\`\`\`json
{
  "name": "${t}",
  "url": "https://<mcp-server-url>",
  "headers": {
    "Authorization": "Bearer \${API_KEY}"
  },
  "description": "<concise one-line description>",
  "version": "1.0.0",
  "updated": "<today's date, YYYY-MM-DD>"
}
\`\`\`

## Key points
- \`name\` must be \`${t}\`
- **Stdio**: \`command\` is the executable (usually \`npx\`), \`args\` is an array, \`env\` holds environment variables with \`\${PLACEHOLDER}\` values
- **HTTP**: \`url\` is the MCP server endpoint, \`headers\` is optional (for auth tokens etc.)
- Do NOT include both \`command\` and \`url\` — pick one transport type
- \`description\`, \`version\`, and \`updated\` are required metadata fields
- The file must be valid JSON

Write the config to \`${a}\`.`):(n=A,s=N||"",i=$,`Modify the MCP server configuration "${n}".

**File to modify:** \`${i}\`

Read the file, then apply these changes:

${s||"Review and improve this MCP configuration. Verify the package exists, update to latest version, and ensure all fields are correct."}

## Rules
- Keep the JSON structure intact
- Update \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep \`name\` as \`${n}\`
- The file must be valid JSON

Write the updated file back to \`${i}\`.`):"create"===k?(o=P,d=T,l=A,c=S,u=$,p=O,E={claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI",gemini:"Gemini CLI"},`Create a new ${E[o]} ${d} called "${l}".

**Format reference:** \`${p}\`
**Output file:** \`${u}\`

## What it should do
${c}

## ${d.charAt(0).toUpperCase()+d.slice(1)} format
${({skill:"Skills are SKILL.md files that give the AI specialized knowledge or workflows. They can be invoked via slash commands. They describe when/how to use the skill and can include a references/ subdirectory for supporting files. The skill directory structure is: skillname/SKILL.md and optionally skillname/references/*.md.",agent:"Agents are custom agent definitions that configure specialized behavior, purpose, capabilities, and tool usage."})[d]||""}

Read the format reference for ${E[o]}-specific conventions, then create the ${d}.

## Required frontmatter

\`\`\`yaml
---
name: ${l}
version: 1.0.0
updated: <today's date, YYYY-MM-DD>
description: "<concise one-line summary>"
---
\`\`\`

All four fields are mandatory. The description should summarize the ${d}'s purpose in one line.
${"agents"===o?`
## Provider-Neutral Language

Since this asset targets the universal .agents/ directory (used by both Codex CLI and Gemini CLI), you MUST write all text in provider-neutral language:
- Do NOT mention specific tools like "Claude Code", "Codex CLI", or "Gemini CLI"
- Use generic terms like "the AI assistant" or "the agent" instead
- The content should work identically across any AI coding tool that reads .agents/
`:""}
Write the complete file to \`${u}\`.`):(h=P,m=T,f=A,v=N||"",g=$,w=O,`Modify the ${({claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI",gemini:"Gemini CLI"})[h]} ${m} "${f}".

**File to modify:** \`${g}\`
**Format reference:** \`${w}\`

Read the file, then apply these changes:

${v||"Review and improve this asset. Fix any issues, improve clarity, and ensure it follows best practices."}

## Frontmatter rules
- Bump the \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep all other frontmatter fields intact (\`name\`, \`description\`)
- If any required field is missing, add it

Write the updated file back to \`${g}\`.`),x.NextResponse.json({prompt:b,outputPath:$})}catch(e){return console.error("Asset assistant failed:",e),x.NextResponse.json({error:"Failed to generate assistant prompt",details:String(e)},{status:500})}}e.s(["POST",()=>w],21964);var E=e.i(21964);let $=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/cli-assets/assistant/route",pathname:"/api/cli-assets/assistant",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/web/src/app/api/cli-assets/assistant/route.ts",nextConfigOutput:"standalone",userland:E}),{workAsyncStorage:b,workUnitAsyncStorage:k,serverHooks:P}=$;function T(){return(0,a.patchFetch)({workAsyncStorage:b,workUnitAsyncStorage:k})}async function A(e,t,a){$.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let x="/api/cli-assets/assistant/route";x=x.replace(/\/index$/,"")||"/";let y=await $.prepare(e,t,{srcPage:x,multiZoneDraftMode:!1});if(!y)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:R,params:C,nextConfig:w,parsedUrl:E,isDraftMode:b,prerenderManifest:k,routerServerContext:P,isOnDemandRevalidate:T,revalidateOnlyGenerated:A,resolvedPathname:S,clientReferenceManifest:N,serverActionsManifest:M}=y,O=(0,o.normalizeAppPath)(x),I=!!(k.dynamicRoutes[O]||k.routes[S]),j=async()=>((null==P?void 0:P.render404)?await P.render404(e,t,E,!1):t.end("This page could not be found"),null);if(I&&!b){let e=!!k.routes[S],t=k.dynamicRoutes[O];if(t&&!1===t.fallback&&!e){if(w.experimental.adapterPath)return await j();throw new v.NoFallbackError}}let q=null;!I||$.isDev||b||(q="/index"===(q=S)?"/":q);let _=!0===$.isDev||!I,U=I&&!_;M&&N&&(0,i.setManifestsSingleton)({page:x,clientReferenceManifest:N,serverActionsManifest:M});let D=e.method||"GET",L=(0,s.getTracer)(),H=L.getActiveScopeSpan(),K={params:C,prerenderManifest:k,renderOpts:{experimental:{authInterrupts:!!w.experimental.authInterrupts},cacheComponents:!!w.cacheComponents,supportsDynamicResponse:_,incrementalCache:(0,n.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:w.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,n)=>$.onRequestError(e,t,a,n,P)},sharedContext:{buildId:R}},Y=new d.NodeNextRequest(e),F=new d.NodeNextResponse(t),W=l.NextRequestAdapter.fromNodeNextRequest(Y,(0,l.signalFromNodeResponse)(t));try{let i=async e=>$.handle(W,K).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=L.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==c.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=r.get("next.route");if(a){let t=`${D} ${a}`;e.setAttributes({"next.route":a,"http.route":a,"next.span_name":t}),e.updateName(t)}else e.updateName(`${D} ${x}`)}),o=!!(0,n.getRequestMeta)(e,"minimalMode"),d=async n=>{var s,d;let l=async({previousCacheEntry:r})=>{try{if(!o&&T&&A&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let s=await i(n);e.fetchMetrics=K.renderOpts.fetchMetrics;let d=K.renderOpts.pendingWaitUntil;d&&a.waitUntil&&(a.waitUntil(d),d=void 0);let l=K.renderOpts.collectedTags;if(!I)return await (0,p.sendResponse)(Y,F,s,K.renderOpts.pendingWaitUntil),null;{let e=await s.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(s.headers);l&&(t[f.NEXT_CACHE_TAGS_HEADER]=l),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,a=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=f.INFINITE_CACHE?void 0:K.renderOpts.collectedExpire;return{value:{kind:g.CachedRouteKind.APP_ROUTE,status:s.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:a}}}}catch(t){throw(null==r?void 0:r.isStale)&&await $.onRequestError(e,t,{routerKind:"App Router",routePath:x,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:T})},!1,P),t}},c=await $.handleResponse({req:e,nextConfig:w,cacheKey:q,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:k,isRoutePPREnabled:!1,isOnDemandRevalidate:T,revalidateOnlyGenerated:A,responseGenerator:l,waitUntil:a.waitUntil,isMinimalMode:o});if(!I)return null;if((null==c||null==(s=c.value)?void 0:s.kind)!==g.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==c||null==(d=c.value)?void 0:d.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});o||t.setHeader("x-nextjs-cache",T?"REVALIDATED":c.isMiss?"MISS":c.isStale?"STALE":"HIT"),b&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let v=(0,h.fromNodeOutgoingHttpHeaders)(c.value.headers);return o&&I||v.delete(f.NEXT_CACHE_TAGS_HEADER),!c.cacheControl||t.getHeader("Cache-Control")||v.get("Cache-Control")||v.set("Cache-Control",(0,m.getCacheControlHeader)(c.cacheControl)),await (0,p.sendResponse)(Y,F,new Response(c.value.body,{headers:v,status:c.value.status||200})),null};H?await d(H):await L.withPropagatedContext(e.headers,()=>L.trace(c.BaseServerSpan.handleRequest,{spanName:`${D} ${x}`,kind:s.SpanKind.SERVER,attributes:{"http.method":D,"http.target":e.url}},d))}catch(t){if(t instanceof v.NoFallbackError||await $.onRequestError(e,t,{routerKind:"App Router",routePath:O,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:T})},!1,P),I)throw t;return await (0,p.sendResponse)(Y,F,new Response(null,{status:500})),null}}e.s(["handler",()=>A,"patchFetch",()=>T,"routeModule",()=>$,"serverHooks",()=>P,"workAsyncStorage",()=>b,"workUnitAsyncStorage",()=>k],77649)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__a5207d53._.js.map