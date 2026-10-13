import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export async function publish() {
  const repo=process.env.GITHUB_REPOSITORY;
  if(repo!=='st7833232/taiwan-stock-dashboard-data') throw Error('Publication restricted to authorized data repository');
  const token=process.env.GITHUB_TOKEN;if(!token) throw Error('GITHUB_TOKEN required');
  const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
  const base=git('rev-parse','HEAD');
  const retryable=new Set([429,500,502,503,504]),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const api=async(p,body,method=body?'POST':'GET')=>{
    let lastError;
    for(let attempt=0;attempt<6;attempt++){
      try{
        const response=await fetch(`https://api.github.com/repos/${repo}/${p}`,{method,headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'content-type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
        if(response.ok)return response.json();
        const detail=(await response.text()).slice(0,1500);
        lastError=Error(`GitHub ${method} ${p}: HTTP ${response.status}; detail=${detail}`);
        if(!retryable.has(response.status)||attempt===5)throw lastError;
        const retryAfter=Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:Math.min(1000*2**attempt,16000));
      }catch(error){
        lastError=error;
        if(attempt===5||/^GitHub /.test(String(error?.message??''))&&!/HTTP (429|500|502|503|504)(?:;|$)/.test(String(error.message)))throw error;
        await sleep(Math.min(1000*2**attempt,16000));
      }
    }
    throw lastError;
  };
  const allowed=['raw/','history/','snapshots/'];
  const all=[...new Set([...git('diff','--name-only','HEAD').split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean))];
  const paths=all.filter(p=>p==='manifest.json'||allowed.some(prefix=>p.startsWith(prefix)));
  if(all.some(p=>!paths.includes(p))) throw Error('Unexpected workflow changes outside authorized data outputs');
  if(!paths.length){console.log('NO_CHANGE');return;}
  // Compare-and-stop before creating objects; no rebase or overwriting new data.
  const ref=await api('git/ref/heads/main');if(ref.object.sha!==base) throw Error('MAIN_HEAD_CHANGED: retain workflow artifact and rerun on new main');
  // Stage only authorized data outputs and publish through native Git transport.
  // GitHub's REST git/blobs endpoint rejects large valid blobs with HTTP 422.
  // Git object transfer via git push avoids that REST request-size restriction.
  for(const p of paths) {
    if(!fs.existsSync(p)) throw Error(`Deletion forbidden: ${p}`);
    if(p.startsWith('snapshots/') && git('ls-files',p)) throw Error(`Immutable snapshot modification: ${p}`);
    const size=fs.statSync(p).size;
    if(size>100*1024*1024) throw Error(`GITHUB_BLOB_SIZE_LIMIT: ${p} (${size} bytes) exceeds GitHub's 100 MiB single-file limit`);
  }
  execFileSync('git',['add','--',...paths],{stdio:'pipe'});
  // Official raw HTML/OCR evidence is immutable source material: CRLF and trailing whitespace are valid bytes.
  // Schema, provenance, evidence and trading validation run upstream; Git whitespace lint is not a publication gate.
  // Keep the staged-change check and immutable-snapshot protection below.

  if(!git('diff','--cached','--name-only')){console.log('NO_CHANGE');return;}
  const tree=git('write-tree');
  const gitIdentity={...process.env,
    GIT_AUTHOR_NAME:'github-actions[bot]',
    GIT_AUTHOR_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com',
    GIT_COMMITTER_NAME:'github-actions[bot]',
    GIT_COMMITTER_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com',
  };
  const commit=execFileSync('git',['commit-tree',tree,'-p',base,'-m',`data: official screening checkpoint ${process.env.TARGET_DATE}`],{encoding:'utf8',env:gitIdentity}).trim();
  const again=await api('git/ref/heads/main');
  if(again.object.sha!==base) throw Error('MAIN_HEAD_CHANGED: retain workflow artifact and rerun on new main');
  // Push an explicit fast-forward update. Never force-push or rebase data.
  const remote=`https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`;
  try {
    execFileSync('git',['-c','credential.helper=','push',remote,`${commit}:refs/heads/main`],{
      encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,
    });
  } catch(error) {
    const diagnostic=String(error.stderr??'').replaceAll(token,'[REDACTED]').slice(-1800);
    throw Error(`NATIVE_GIT_PUBLICATION_FAILED: ${diagnostic}`,{cause:error});
  }
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nAtomic data commit: ${commit}\n`);
  console.log(`PUBLISHED_COMMIT=${commit}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await publish();
