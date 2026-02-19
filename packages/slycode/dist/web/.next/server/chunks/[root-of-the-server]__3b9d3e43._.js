module.exports=[18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},14747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},22734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},7367,e=>{"use strict";var t=e.i(14747),r=e.i(22734);function a(){if(process.env.SLYCODE_HOME)return process.env.SLYCODE_HOME;let e=process.cwd();return(console.warn("[paths] SLYCODE_HOME not set in production — falling back to cwd:",e),e.endsWith("/web")||e.endsWith("\\web"))?t.default.dirname(e):e}function n(){let e=a(),n=t.default.join(e,"node_modules","@slycode","slycode","dist");return r.default.existsSync(n)?n:e}function s(){return process.env.BRIDGE_URL?process.env.BRIDGE_URL:"http://127.0.0.1:3004"}e.s(["getBridgeUrl",()=>s,"getPackageDir",()=>n,"getSlycodeRoot",()=>a])},36688,e=>{"use strict";var t=e.i(47909),r=e.i(74017),a=e.i(96250),n=e.i(59756),s=e.i(61916),i=e.i(74677),o=e.i(69741),l=e.i(16795),d=e.i(87718),c=e.i(95169),u=e.i(47587),p=e.i(66012),h=e.i(70101),f=e.i(74838),m=e.i(10372),g=e.i(93695);e.i(52474);var v=e.i(220),x=e.i(89171),y=e.i(22734),R=e.i(14747),C=e.i(7367);async function w(e){try{var t,r,a,n,s,i,o,l,d,c,u,p,h,f,m,g,v,w;let $,b,E,k,{mode:N,provider:S,assetType:A,assetName:O,description:P,changes:T}=await e.json();if(!N||!S||!A)return x.NextResponse.json({error:"mode, provider, and assetType are required"},{status:400});if("create"===N&&(!O||!P))return x.NextResponse.json({error:"assetName and description are required for create mode"},{status:400});if("modify"===N&&!O)return x.NextResponse.json({error:"assetName is required for modify mode"},{status:400});let j=(0,C.getSlycodeRoot)();if("mcp"===A)E=R.default.join(j,`store/mcp/${O}.json`);else{let e="skill"===A?"skills":"agents",t="skill"===A?`store/${e}/${O}/SKILL.md`:`store/${e}/${O}.md`;E=R.default.join(j,t)}let I=R.default.join(j,"documentation","reference","ai_cli_providers.md");if("modify"===N&&!y.default.existsSync(E)){if("mcp"===A)return x.NextResponse.json({error:`Could not find MCP config '${O}' at ${E}`},{status:404});if("skill"!==A)return x.NextResponse.json({error:`Could not find asset '${O}' in store at ${E}`},{status:404})}return k="mcp"===A?"create"===N?(t=O,r=P,a=E,$=R.default.join(R.default.dirname(a),"context7.json"),`Create an MCP (Model Context Protocol) server configuration called "${t}".

**Output file:** \`${a}\`
**Example config:** \`${$}\`

## What this MCP server should do
${r}

## Research steps

1. Read the example config at \`${$}\` to understand the JSON format
2. Research the MCP server package described above — find the correct npm package name, command, and required arguments
3. Check if there are any required environment variables or setup steps
4. Determine the correct \`command\` and \`args\` to launch the server

## Required JSON format

\`\`\`json
{
  "name": "${t}",
  "command": "<executable, e.g. npx, node, python>",
  "args": ["<arguments to launch the MCP server>"],
  "description": "<concise one-line description of what this MCP server provides>",
  "version": "1.0.0",
  "updated": "<today's date, YYYY-MM-DD>"
}
\`\`\`

Key points:
- \`name\` must be \`${t}\`
- \`command\` is the executable (usually \`npx\` for npm packages)
- \`args\` is an array of arguments (for npx, typically \`["-y", "@scope/package@latest"]\`)
- If the server needs environment variables, add an \`"env"\` object with the variable names and placeholder values
- The file must be valid JSON

Write the config to \`${a}\`.`):(n=O,s=T||"",i=E,`Modify the MCP server configuration "${n}".

**File to modify:** \`${i}\`

Read the file, then apply these changes:

${s||"Review and improve this MCP configuration. Verify the package exists, update to latest version, and ensure all fields are correct."}

## Rules
- Keep the JSON structure intact
- Update \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep \`name\` as \`${n}\`
- The file must be valid JSON

Write the updated file back to \`${i}\`.`):"create"===N?(o=S,l=A,d=O,c=P,u=E,p=I,b={claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI",gemini:"Gemini CLI"},`Create a new ${b[o]} ${l} called "${d}".

**Format reference:** \`${p}\`
**Output file:** \`${u}\`

## What it should do
${c}

## ${l.charAt(0).toUpperCase()+l.slice(1)} format
${({skill:"Skills are SKILL.md files that give the AI specialized knowledge or workflows. They can be invoked via slash commands. They describe when/how to use the skill and can include a references/ subdirectory for supporting files. The skill directory structure is: skillname/SKILL.md and optionally skillname/references/*.md.",agent:"Agents are custom agent definitions that configure specialized behavior, purpose, capabilities, and tool usage."})[l]||""}

Read the format reference for ${b[o]}-specific conventions, then create the ${l}.

## Required frontmatter

\`\`\`yaml
---
name: ${d}
version: 1.0.0
updated: <today's date, YYYY-MM-DD>
description: "<concise one-line summary>"
---
\`\`\`

All four fields are mandatory. The description should summarize the ${l}'s purpose in one line.
${"agents"===o?`
## Provider-Neutral Language

Since this asset targets the universal .agents/ directory (used by both Codex CLI and Gemini CLI), you MUST write all text in provider-neutral language:
- Do NOT mention specific tools like "Claude Code", "Codex CLI", or "Gemini CLI"
- Use generic terms like "the AI assistant" or "the agent" instead
- The content should work identically across any AI coding tool that reads .agents/
`:""}
Write the complete file to \`${u}\`.`):(h=S,f=A,m=O,g=T||"",v=E,w=I,`Modify the ${({claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI",gemini:"Gemini CLI"})[h]} ${f} "${m}".

**File to modify:** \`${v}\`
**Format reference:** \`${w}\`

Read the file, then apply these changes:

${g||"Review and improve this asset. Fix any issues, improve clarity, and ensure it follows best practices."}

## Frontmatter rules
- Bump the \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep all other frontmatter fields intact (\`name\`, \`description\`)
- If any required field is missing, add it

Write the updated file back to \`${v}\`.`),x.NextResponse.json({prompt:k,outputPath:E})}catch(e){return console.error("Asset assistant failed:",e),x.NextResponse.json({error:"Failed to generate assistant prompt",details:String(e)},{status:500})}}e.s(["POST",()=>w],82398);var $=e.i(82398);let b=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/cli-assets/assistant/route",pathname:"/api/cli-assets/assistant",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/cli-assets/assistant/route.ts",nextConfigOutput:"standalone",userland:$}),{workAsyncStorage:E,workUnitAsyncStorage:k,serverHooks:N}=b;function S(){return(0,a.patchFetch)({workAsyncStorage:E,workUnitAsyncStorage:k})}async function A(e,t,a){b.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let x="/api/cli-assets/assistant/route";x=x.replace(/\/index$/,"")||"/";let y=await b.prepare(e,t,{srcPage:x,multiZoneDraftMode:!1});if(!y)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:R,params:C,nextConfig:w,parsedUrl:$,isDraftMode:E,prerenderManifest:k,routerServerContext:N,isOnDemandRevalidate:S,revalidateOnlyGenerated:A,resolvedPathname:O,clientReferenceManifest:P,serverActionsManifest:T}=y,j=(0,o.normalizeAppPath)(x),I=!!(k.dynamicRoutes[j]||k.routes[O]),M=async()=>((null==N?void 0:N.render404)?await N.render404(e,t,$,!1):t.end("This page could not be found"),null);if(I&&!E){let e=!!k.routes[O],t=k.dynamicRoutes[j];if(t&&!1===t.fallback&&!e){if(w.experimental.adapterPath)return await M();throw new g.NoFallbackError}}let q=null;!I||b.isDev||E||(q="/index"===(q=O)?"/":q);let _=!0===b.isDev||!I,U=I&&!_;T&&P&&(0,i.setManifestsSingleton)({page:x,clientReferenceManifest:P,serverActionsManifest:T});let D=e.method||"GET",L=(0,s.getTracer)(),H=L.getActiveScopeSpan(),F={params:C,prerenderManifest:k,renderOpts:{experimental:{authInterrupts:!!w.experimental.authInterrupts},cacheComponents:!!w.cacheComponents,supportsDynamicResponse:_,incrementalCache:(0,n.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:w.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,n)=>b.onRequestError(e,t,a,n,N)},sharedContext:{buildId:R}},K=new l.NodeNextRequest(e),Y=new l.NodeNextResponse(t),W=d.NextRequestAdapter.fromNodeNextRequest(K,(0,d.signalFromNodeResponse)(t));try{let i=async e=>b.handle(W,F).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=L.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==c.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=r.get("next.route");if(a){let t=`${D} ${a}`;e.setAttributes({"next.route":a,"http.route":a,"next.span_name":t}),e.updateName(t)}else e.updateName(`${D} ${x}`)}),o=!!(0,n.getRequestMeta)(e,"minimalMode"),l=async n=>{var s,l;let d=async({previousCacheEntry:r})=>{try{if(!o&&S&&A&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let s=await i(n);e.fetchMetrics=F.renderOpts.fetchMetrics;let l=F.renderOpts.pendingWaitUntil;l&&a.waitUntil&&(a.waitUntil(l),l=void 0);let d=F.renderOpts.collectedTags;if(!I)return await (0,p.sendResponse)(K,Y,s,F.renderOpts.pendingWaitUntil),null;{let e=await s.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(s.headers);d&&(t[m.NEXT_CACHE_TAGS_HEADER]=d),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==F.renderOpts.collectedRevalidate&&!(F.renderOpts.collectedRevalidate>=m.INFINITE_CACHE)&&F.renderOpts.collectedRevalidate,a=void 0===F.renderOpts.collectedExpire||F.renderOpts.collectedExpire>=m.INFINITE_CACHE?void 0:F.renderOpts.collectedExpire;return{value:{kind:v.CachedRouteKind.APP_ROUTE,status:s.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:a}}}}catch(t){throw(null==r?void 0:r.isStale)&&await b.onRequestError(e,t,{routerKind:"App Router",routePath:x,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:S})},!1,N),t}},c=await b.handleResponse({req:e,nextConfig:w,cacheKey:q,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:k,isRoutePPREnabled:!1,isOnDemandRevalidate:S,revalidateOnlyGenerated:A,responseGenerator:d,waitUntil:a.waitUntil,isMinimalMode:o});if(!I)return null;if((null==c||null==(s=c.value)?void 0:s.kind)!==v.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==c||null==(l=c.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});o||t.setHeader("x-nextjs-cache",S?"REVALIDATED":c.isMiss?"MISS":c.isStale?"STALE":"HIT"),E&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let g=(0,h.fromNodeOutgoingHttpHeaders)(c.value.headers);return o&&I||g.delete(m.NEXT_CACHE_TAGS_HEADER),!c.cacheControl||t.getHeader("Cache-Control")||g.get("Cache-Control")||g.set("Cache-Control",(0,f.getCacheControlHeader)(c.cacheControl)),await (0,p.sendResponse)(K,Y,new Response(c.value.body,{headers:g,status:c.value.status||200})),null};H?await l(H):await L.withPropagatedContext(e.headers,()=>L.trace(c.BaseServerSpan.handleRequest,{spanName:`${D} ${x}`,kind:s.SpanKind.SERVER,attributes:{"http.method":D,"http.target":e.url}},l))}catch(t){if(t instanceof g.NoFallbackError||await b.onRequestError(e,t,{routerKind:"App Router",routePath:j,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:S})},!1,N),I)throw t;return await (0,p.sendResponse)(K,Y,new Response(null,{status:500})),null}}e.s(["handler",()=>A,"patchFetch",()=>S,"routeModule",()=>b,"serverHooks",()=>N,"workAsyncStorage",()=>E,"workUnitAsyncStorage",()=>k],36688)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__3b9d3e43._.js.map