// Build the public Chrome download alongside the website. Release binaries stay
// out of Git and are generated from the exact source being deployed.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const web=path.resolve(__dirname,'..'),extension=path.resolve(web,'../extension');
(async()=>{
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(extension,'scripts/build.cjs')],{cwd:extension,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Chrome extension build failed.')));});
  const version=require(path.join(extension,'package.json')).version;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid extension version');
  const filename=`AnchorProposal-Chrome-v${version}.zip`,input=path.join(extension,'release',`v${version}`,filename),content=await fs.readFile(input);
  const output=path.resolve(web,'public/downloads/chrome');
  if(!output.startsWith(web+path.sep)||path.basename(output)!=='chrome')throw Error('Unexpected public download directory');
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,filename+'.new'),content);
  await fs.rename(path.join(output,filename+'.new'),path.join(output,filename));
  await fs.writeFile(path.join(output,'release.json.new'),JSON.stringify({version,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')},null,2)+'\n');
  await fs.rename(path.join(output,'release.json.new'),path.join(output,'release.json'));
  console.log(`Public Chrome download ready: /downloads/chrome/${filename}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
