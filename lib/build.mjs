#!/usr/bin/env node

import fs from 'node:fs';
const fsp=fs.promises;

import path from 'node:path';
import child_process from 'node:child_process';

import readline from "node:readline/promises"

const { spawn,spawnSync } = child_process ;

const csl=console.log;
const cse=console.error;


const gb = { args:[] } ;
let cfg = {} ;
let jc = {config:{}} ;
let cliArgsMap = Object.create(null);

const cmd_enum =
{
  FROM:1, RUN:1, ENTRYPOINT:1, CMD:1,
  COPY:1, ADD:1, WORKDIR:1, ENV:1, ARG:1,
  EXPOSE:1,VOLUME:1,LABEL:1,SHELL:1,STOPSIGNAL:1,
  HEALTHCHECK:1,ONBUILD:1,USER:1
}

const cmd_func = {} ;

var prefix="";

const isTermux=((process.env.PREFIX||'')+'').includes("termux");

if(isTermux)
  prefix="/data/data/com.termux/files/usr/bin/";
else if(process.env.PKG_RDIR)
{
  prefix=process.env.PKG_RDIR+'/bin/'
}

const udroot=(process.env.HOME||'')+"/.udocker/containers/";

var img_tag = "null";
var imode = "i";


var wd='/';

let jsonFile="";
let rootfs="";
let rl = null;

function syncBuildPaths()
{
  jsonFile=udroot+img_tag+'/container.json';
  rootfs=udroot+img_tag+'/ROOT';
}

function initFromProcessArgv()
{
  initBuild({
    tag: psarg`-t` || psarg`--tag` || "null",
    mode: psarg`-n` ? "n" : (psarg`-y` ? "y" : "i"),
  });
}

export function initBuild(opt={})
{
  img_tag = (opt.tag || "null")+"";
  imode = (opt.mode || "i")+"";
  wd='/';
  cfg = {};
  jc = { config:{} };
  gb.args = [];
  cliArgsMap = Object.create(null);
  if(Array.isArray(opt.buildArgs))
  {
    for(const s of opt.buildArgs)
    {
      const kv=parseKeyval(s);
      if(kv && kv[0])
        cliArgsMap[kv[0]]=kv[1];
    }
  }
  syncBuildPaths();
}

export function closeBuildSession()
{
  if(rl)
  {
    rl.close();
    rl=null;
  }
}

export async function buildDockerfile(opt={})
{
  initBuild(opt);
  try
  {
    await parseDockerfile(opt.filepath || 'Dockerfile');
  }
  finally
  {
    closeBuildSession();
  }
}

export async function parseDockerfile(fpath='Dockerfile')
{
  if(!jsonFile || !rootfs)
    initFromProcessArgv();

  let cmdarr=[];
  let cind=0;

  let rows=fs.readFileSync(fpath)
             .toString()
             .trim().split("\n");

  
  for(let rind=0; rind<rows.length; rind++)
  {
    let row=rows[rind].trim();

    if(!row || row[0]=='#')
      continue;

    let wholecmd, cmd, tind

    let getcmd=(myrow)=>
    {
      let tind=myrow.indexOf(" ");
      if(tind != -1)
        return myrow.slice(0,tind);
      else
        return myrow ;
    }

    tind=row.indexOf(" ");
    cmd = getcmd(row) ;

    if(cmd_func[cmd])
    {
      wholecmd = row.slice(tind+1);

      for(let i=rind+1; i<rows.length; i++)
      {
        let srow=rows[i].trim();
        if(!srow || srow[0]=='#')
          continue;

        if(cmd_enum[getcmd(srow)])
        {
          rind=i-1;
          break;
        }
        else
          wholecmd+="\n"+srow;          
      }

      if(typeof cmd_func[cmd]=="function")      
      {
        await cmd_func[cmd](wholecmd);
        csl("");
      }

    }
    else
    {
      cse("[Unsupported]");
      cse(cmd);
      cse("")
      continue;
    }    
    
  }  //  for rind rows

  if(isTermux)
  {
    csl("In Termux if you want to run binaries from native Termux inside the container(proot), run something like this:");
    csl("  udocker run --volume=/system --volume=/apex --volume=/data --volume=/linkerconfig/ld.config.txt "+img_tag+" bash");
  }
  
}  //  func parseDockerfile

export async function FROM(str)
{
  csl('[FROM]')

  let arr=(str+'').trim().split(/\s+/g);

  let img=(arr[0]+'').split('@',1)[0]+'';

  csl("Image to pull:",img);
  csl("Container name:",img_tag);

  //return;

  if(fs.existsSync(udroot+img_tag))
    csl("Already Pulled:",img);
  else
  {

  let r=await new Promise(res=>{
  
    const p=spawn(prefix+"udocker",
      ["run","--platform=linux/arm64","--name="+img_tag, img,"echo","Pulled: "+img],{stdio:"inherit",env:process.env});

    p.on("error",res);
    p.on("close",res);
  
  });

  csl(r);

  } // else have not pulled img

  try{

  jc = JSON.parse(
            fs.readFileSync(jsonFile).toString()
          );

  cfg = jc.config;

  if(cfg.WorkingDir)
    wd=cfg.WorkingDir;

  await fsp.mkdir(path.join(rootfs,wd), { recursive: true });

  if(cfg.Env)
  {
    for(let s of cfg.Env)
    {
      let kv=parseKeyval(s);
      process.env[ kv[0] ] = kv[1] ;
      
      cse("Set Env pair:",kv)
    }
  }

  csl("Image config:",cfg);

  }catch(e){cse(e);}
}

export async function COPY(str)
{
  csl('[COPY]')
  cse(str)

  let sarr=str.trim().split("\n");
  
  for(let i of sarr)
  {
    i=i.trim();
    if(i.endsWith("\\"))
      i=i.slice(0,-1);

    let arr=i.trim().split(/\s+/g)
             .filter(i=>!i.startsWith("-"));

    if(arr.at(-1).startsWith("/"))
      arr[arr.length-1]=path.join(rootfs,arr.at(-1));
    else
      arr[arr.length-1]=path.join(rootfs,wd,arr.at(-1));

    let mdp;
    
    if(arr.length>2)
      mdp=arr.at(-1);
    else if(dexists(arr[0]))
      mdp=arr.at(-1);
    else
      mdp=path.dirname(arr.at(-1)) ;
      
    cse("Making folder:",mdp);

    await fsp.mkdir(mdp, { recursive: true });

    for(let ii=0;ii<arr.length-1;ii++)
    {
      if(dexists(arr[ii]))
        arr[ii]+="/.";
    }

    cse("cp",["-a",...arr]);

  
  if(!await nconfirm("copy"))
    return;


  let r=await new Promise(res=>{

    const p=
      spawn( "cp",["-a",...arr],
             {stdio:"inherit",env:process.env} );

    p.on("error",res);
    p.on("close",res);

  });

  csl(r);

  

  } // multi lines of copy


}

var runcount=1;

export async function RUN(str)
{
  csl('[RUN]')
  cse(str)


  let rpi="/build_script"+runcount+".sh";

  let rp=path.join(rootfs,rpi)

  runcount++;

  await fsp.writeFile(rp,str);


  var script_runner="sh";
  
  if(fexists(
       path.join(rootfs,"/bin/bash")
     )
     ||
     fexists(
       path.join(rootfs,"/usr/bin/bash")
     )
    )
    script_runner="bash";
    

  csl(prefix+"udocker",["run",img_tag,"env",...gb.args,script_runner,rpi])


  if(!await nconfirm("run"))
    return;


  let r=await new Promise(res=>{
  
    const p=
      spawn( prefix + "udocker",
        ["run",img_tag,"env",...gb.args,script_runner,rpi],
        {stdio:"inherit",env:process.env} );

    p.on("error",res);
    p.on("close",res);
  
  });

  csl(r);

}

export function LABEL(str)
{
  csl('[LABEL]');
  cse(str);

  if(!cfg.Labels)
    cfg.Labels={};

  str.trim().split("\n").forEach(i=>{

    let r=parseKeyval(i);

    if(r)
      cfg.Labels[ r[0] ] = r[1] ;
    
    
  });

  writeConfig();

}

export async function WORKDIR(str)
{
  csl("[WORKDIR]");
  
  str=str.trim()

  if(str.startsWith("/"))
    wd=str;
  else
    wd=path.join(wd,str);

  await fsp.mkdir(path.join(rootfs,wd), { recursive: true });

  cfg.WorkingDir=wd;

  writeConfig();

  csl("Changed cwd:",wd)

}

export async function ENV(str)
{
  csl('[ENV]');
  cse(str);
  

  if(!cfg.Env)
    cfg.Env=[];

  str.trim().split("\n").forEach(i=>{

    let r=parseKeyval(i);

    if(r)
    {
      let s=r.join("=");

      if(!cfg.Env.includes(s))
        cfg.Env.push(s);

    }

  });

  csl("Env:",cfg.Env);

  if(await nconfirm("set Env"))
    writeConfig();
}

export function ARG(str)
{
  csl('[ARG]');
  cse(str);

  str.trim().split("\n").forEach(i=>{
    i=((i||"")+"").trim();
    if(!i)
      return;

    let key="";
    let defaultVal="";

    let r=parseKeyval(i);
    if(r)
    {
      key=r[0];
      defaultVal=r[1];
    }
    else
      key=i.split(/\s+/g)[0];

    if(!key)
      return;

    const hasCli = Object.prototype.hasOwnProperty.call(cliArgsMap,key);
    const finalVal = hasCli ? cliArgsMap[key] : defaultVal;

    process.env[key] = finalVal;
    cse("Set ARG pair:",[key,finalVal], hasCli ? "(cli override)" : "(default)");

    const s=key+"="+finalVal;
    const argInd = gb.args.findIndex(v => (v+"").startsWith(key+"="));
    if(argInd === -1)
      gb.args.push(s);
    else
      gb.args[argInd]=s;

  });  
}

export function CMD(str)
{
  csl("[CMD]");
  cse(str);

  str=str.trim();

  if(str.startsWith("["))
  {
    try{

    let arr=JSON.parse(str);

    if(Array.isArray(arr))
    {
      cfg.Cmd=arr;

      csl("Changed Cmd:",arr)

      writeConfig();
    }
    
    }catch(e){cse(e)}
  }

}

cmd_func.FROM=FROM
cmd_func.WORKDIR=WORKDIR
cmd_func.ENV=ENV
cmd_func.ARG=ARG
cmd_func.CMD=CMD


cmd_func.COPY=COPY
cmd_func.RUN=RUN
cmd_func.LABEL=LABEL

export function parseKeyval(i)
{
    i=((i||'')+'').trim()
    
    let tind=i.indexOf("=");
    
    if(tind!=-1)
    {
      let val=i.slice(tind+1);

      if(val.endsWith("\\"))
        val=val.slice(0,-1);

      val=spawnSync('/bin/sh',['-c','printf "%s" '+val],{env:process.env}).stdout.toString().trim();
      
      return [i.slice(0,tind) , val] ;
    }

}

export function writeConfig()
{
  Object.assign(jc.config,cfg);

  fs.writeFileSync(jsonFile,JSON.stringify(jc));

}

export async function nconfirm(action)
{
  let r;
  if(imode=='i')                            {
    if(!rl)
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    csl(`Want to ${action} the above?`);
    r = await rl.question("(y/N)");
  }
  else
    r = imode ;
                                            if((r+'').toLowerCase().includes("y"))
  {
    cse(`Doing ${action}`);
    return true
  }
  else
  {
    cse(`Aborting ${action}`);
    return false;
  }
}

export function psarg( argName,strip=false,stripNext=true )
{
  argName = (argName || "")+"" ;

  let ind = process.argv.indexOf(argName);
  if( ind != -1)
  {
    const nextArg = process.argv[ind+1]

    if(strip)
      process.argv.splice(ind,1);

    if( nextArg )
    {
      if(stripNext)
        process.argv.splice(ind,1);
        
      return nextArg ;
    }

    return "present";
  }

  return "" ;
}

export function dexists(dpath)
{
try
  {
    var stats=fs.statSync(dpath);
    if(stats.isDirectory())
        return true;

    return false;
  }
catch(e)
  {
    return false;
  }
}


export function fexists(fpath)
{
try
  {
    var stats=fs.lstatSync(fpath);
    
    return true;
  }
catch(e)
  {
    return false;
  }
}


//parseDockerfile();
