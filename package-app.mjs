import {build as buildElectron,Platform,Arch} from 'electron-builder';
import {build} from 'esbuild';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';

// A running editor can lock only some files; replacing its directory can leave a partial installation.
const out=path.resolve('release','builds',`${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
const root=process.cwd(),exec=promisify(execFile),createdAt=new Date().toISOString();
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const sourceCommit=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
const sourceStatus=(await exec('git',['status','--porcelain'],{cwd:root})).stdout.trim();
if(sourceStatus)throw new Error('Release packaging requires a clean committed source tree. Commit the reviewed changes first.');
// Electron downloads its runtime lazily; a fresh npm ci has no executable yet.
createRequire(import.meta.url)('electron');
// Check the Windows signature provider before spending time packaging artifacts.
await signingStatus(path.join(root,'node_modules','electron','dist','electron.exe'));
const stage=path.join(out,'staging');
await fs.mkdir(path.join(stage,'src'),{recursive:true});
for(const entry of await fs.readdir('src'))if(entry.endsWith('.cjs')||entry==='index.html')await fs.copyFile(path.join('src',entry),path.join(stage,'src',entry));
await fs.copyFile('LICENSE',path.join(stage,'LICENSE'));
// A future external import must not silently lose its runtime dependency during staging.
const bundled=await build({entryPoints:['src/renderer.js'],bundle:true,outfile:path.join(stage,'dist','renderer.js'),loader:{'.css':'css'},metafile:true});
for(const output of Object.values(bundled.metafile.outputs))if(output.imports.some(item=>item.external))throw new Error('Renderer has external imports; update runtime staging.');
const runtime=new Map();
async function copyRuntime(name,from=root){
  if(runtime.has(name))return;
  const require=createRequire(path.join(from,'package.json'));
  let manifest;
  try{manifest=require.resolve(`${name}/package.json`);}catch(error){
    if(error.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw error;
    let candidate=path.dirname(require.resolve(name));
    for(;;){
      const file=path.join(candidate,'package.json');
      try{if(JSON.parse(await fs.readFile(file,'utf8')).name===name){manifest=file;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
      const parent=path.dirname(candidate);if(parent===candidate)throw new Error(`Cannot locate runtime manifest for ${name}`);candidate=parent;
    }
  }
  const dir=path.dirname(manifest);
  const dependency=JSON.parse(await fs.readFile(manifest,'utf8'));
  runtime.set(name,dependency.version);
  await fs.cp(dir,path.join(stage,'node_modules',name),{recursive:true});
  for(const child of Object.keys(dependency.dependencies||{}))await copyRuntime(child,dir);
}
await copyRuntime('iconv-lite');
await copyRuntime('gpt-tokenizer');
await copyRuntime('@lezer/markdown');
await copyRuntime('@modelcontextprotocol/server');
await copyRuntime('@modelcontextprotocol/node');
await copyRuntime('ajv');
await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,license:pkg.license,main:pkg.main,dependencies:Object.fromEntries(runtime)},null,2));
// Bundling removes package folders, not their attribution obligations.
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));
let notices='OpenPad third-party notices\n\nElectron/Chromium notices are included alongside the executable.\n';
for(const [location,entry] of Object.entries(lock.packages||{})){
  if(!location.startsWith('node_modules/')||entry.dev)continue;
  const dir=path.join(root,location);
  const files=(await fs.readdir(dir)).filter(name=>/^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  if(!files.length)throw new Error(`Missing license notice for ${location}`);
  notices+=`\n===== ${location} ${entry.version} (${entry.license||'see notice'}) =====\n`;
  for(const file of files)if((await fs.stat(path.join(dir,file))).isFile())notices+=`\n${file}\n${await fs.readFile(path.join(dir,file),'utf8')}\n`;
}
await fs.writeFile(path.join(stage,'THIRD-PARTY-NOTICES.txt'),notices);
const electronVersion=JSON.parse(await fs.readFile('node_modules/electron/package.json','utf8')).version;
await buildElectron({projectDir:stage,targets:Platform.WINDOWS.createTarget(['nsis','zip'],Arch.x64),publish:'never',config:{
  appId:'org.openpad.editor',productName:'OpenPad',electronVersion,electronDist:path.join(root,'node_modules','electron','dist'),
  directories:{output:out,buildResources:root},asar:true,npmRebuild:false,publish:null,forceCodeSigning:false,
  files:['src/**/*.cjs','src/index.html','dist/**/*','package.json','LICENSE','THIRD-PARTY-NOTICES.txt','node_modules/**/*'],
  extraFiles:[{from:path.join(stage,'LICENSE'),to:'OPENPAD-LICENSE.txt'},{from:path.join(stage,'THIRD-PARTY-NOTICES.txt'),to:'THIRD-PARTY-NOTICES.txt'}],
  win:{signExecutable:false,artifactName:'OpenPad-${version}-win32-${arch}.${ext}'},
  nsis:{oneClick:false,perMachine:false,selectPerMachineByDefault:false,allowElevation:false,allowToChangeInstallationDirectory:true,
    runAfterFinish:false,deleteAppDataOnUninstall:false,packElevateHelper:false,createDesktopShortcut:false,createStartMenuShortcut:true,
    include:path.join(root,'installer.nsh'),artifactName:'OpenPad-${version}-win32-${arch}-setup.${ext}'},
}});
const directory=path.join(out,'win-unpacked');
const executable=path.join(directory,'OpenPad.exe');
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function inventory(dir,prefix=''){
  const result=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name),relative=prefix+entry.name;
    if(entry.isDirectory())result.push(...await inventory(file,relative+'/'));
    else if(entry.isFile())result.push({path:relative,bytes:(await fs.stat(file)).size,sha256:await digest(file)});
    else throw new Error(`Unexpected package entry: ${file}`);
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path));
}
const files=await inventory(directory),archive=path.join(out,`OpenPad-${pkg.version}-win32-x64.zip`);
const installer=path.join(out,`OpenPad-${pkg.version}-win32-x64-setup.exe`);
async function signingStatus(file){return (await exec('pwsh.exe',['-NoProfile','-NonInteractive','-Command',"(Get-AuthenticodeSignature -LiteralPath $env:OPENPAD_SIGNING_FILE).Status.ToString()"],{env:{...process.env,OPENPAD_SIGNING_FILE:file}})).stdout.trim();}
const signing={requested:'disabled',executable:await signingStatus(executable),installer:await signingStatus(installer)};
if(signing.executable!=='NotSigned'||signing.installer!=='NotSigned')throw new Error('Unexpected Authenticode status for unsigned candidate.');
if((await exec('git',['status','--porcelain'],{cwd:root})).stdout.trim()||(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim()!==sourceCommit)throw new Error('Source changed during packaging; do not release this candidate.');
const manifest={version:pkg.version,createdAt,sourceCommit,sourceDirty:false,sourceStatus,platform:'win32',arch:'x64',signing,unpackedBytes:files.reduce((sum,file)=>sum+file.bytes,0),files,archive:{path:path.basename(archive),bytes:(await fs.stat(archive)).size,sha256:await digest(archive)},installer:{path:path.basename(installer),bytes:(await fs.stat(installer)).size,sha256:await digest(installer),signingStatus:signing.installer}};
const manifestPath=path.join(out,'manifest.json');
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2));
await fs.writeFile(path.join(out,'SHA256SUMS.txt'),`${manifest.archive.sha256}  ${path.basename(archive)}\n${manifest.installer.sha256}  ${path.basename(installer)}\n${await digest(manifestPath)}  manifest.json\n`);
await fs.writeFile(path.resolve('release','latest.json'),JSON.stringify({directory,executable,createdAt,archive,installer,manifest:manifestPath},null,2));
console.log(`Packaged ${executable}\nPortable archive: ${archive}\nInstaller: ${installer}\nManifest: ${manifestPath}`);
