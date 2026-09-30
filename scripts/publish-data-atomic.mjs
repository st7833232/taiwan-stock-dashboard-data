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
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await fetch(`https://api.github.com/repos/${repo}/${p}`,{method,headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'content-type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
        if(response.ok)return response.json();
        lastError=Error(`GitHub ${method} ${p}: HTTP ${response.status}`);
        if(!retryable.has(response.status)||attempt===2)throw lastError;
        const retryAfter=Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:1000*(attempt+1));
      }catch(error){
        lastError=error;
        if(attempt===2||/^GitHub /.test(String(error?.message??''))&&!/HTTP (429|500|502|503|504)$/.test(String(error.message)))throw error;
        await sleep(1000*(attempt+1));
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
  const commit=await api(`git/commits/${base}`), entries=[];
  for(const p of paths) {
    if(!fs.existsSync(p)) throw Error(`Deletion forbidden: ${p}`);
    if(p.startsWith('snapshots/') && git('ls-files',p)) throw Error(`Immutable snapshot modification: ${p}`);
    const blob=await api('git/blobs',{content:fs.readFileSync(p).toString('base64'),encoding:'base64'});
    entries.push({path:p,mode:'100644',type:'blob',sha:blob.sha});
  }
  const tree=await api('git/trees',{base_tree:commit.tree.sha,tree:entries});
  const created=await api('git/commits',{message:`data: official screening checkpoint ${process.env.TARGET_DATE}`,tree:tree.sha,parents:[base]});
  const again=await api('git/ref/heads/main');if(again.object.sha!==base) throw Error('MAIN_HEAD_CHANGED: not updating ref');
  await api('git/refs/heads/main',{sha:created.sha,force:false},'PATCH');
  if((await api('git/ref/heads/main')).object.sha!==created.sha) throw Error('Post-publication main HEAD mismatch');
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nAtomic data commit: ${created.sha}\n`);
  console.log(`PUBLISHED_COMMIT=${created.sha}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await publish();
