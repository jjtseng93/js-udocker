#!/usr/bin/env node

import crypto from "node:crypto"
import fs from 'node:fs';
const fsp=fs.promises;

import path from 'node:path';
import child_process from 'node:child_process';

import readline from "node:readline/promises"

const { spawn,spawnSync } = child_process ;

const csl=console.log;
const cse=console.error;

const realhome=process.env.HOME

const gb = { args:[],FROM_count:0 } ;
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
var img_tago = "null";
var imode = "i";


var wd='/';

let jsonFile="";
let rootfs="";
let ctnDir="";
let rl = null;

function syncBuildPaths()
{
  jsonFile=udroot+img_tag+'/container.json';
  rootfs=udroot+img_tag+'/ROOT';
  ctnDir=udroot+img_tag ;
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
  img_tago = img_tag ;
  
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

  let dfile_text = fs.readFileSync(fpath).toString();
  let rows = dfile_text.trim().split("\n");

  gb.FROM_count = dfile_text.match(/(^|\n)FROM /g)
                  .length ;

  
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
        {
          rind=i
          continue;
        }

        if(cmd_enum[getcmd(srow)])
        {
          rind=i-1;
          break;
        }
        else
        {
          rind=i
          wholecmd+="\n"+srow;          
        }
      }

      if(typeof cmd_func[cmd]=="function")      
      {
        await cmd_func[cmd](wholecmd,rind+1);
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
    csl("  udocker run --volume=/system --volume=/apex --volume=/data --volume=/linkerconfig/ld.config.txt "+img_tago+" bash");
  }
  
}  //  func parseDockerfile


export function ln_sfT(target, link)
{
  try{
    fs.unlinkSync( link );
  }catch(e){}

  try{
    fs.symlinkSync(target, link)
  }catch(e){}
}


export async function FROM(str,lnn)
{
  csl('[FROM]',lnn)

  let arr = (str+'').trim()
                    .split(/\s+/g)
                    .filter(i=>!i.startsWith("-"));


  let img ;

  img = parseKeyval("i="+arr[0])[1];

  img = ((img||"")+'').split('@',1)[0]+'';

  gb.FROM_count-- ; // originally the count of FROMs
  img_tag = img_tago + (gb.FROM_count||"") ;
  //  syncs rootfs jsonFile to img_tag
  syncBuildPaths();

  csl("Image/Container to pull:",img);
  csl("Container name:",img_tag);

  if(arr[1].toUpperCase()=="AS")
  {
    let link = arr[2].trim();
    if(link.endsWith("\\")) 
      link=link.slice(0,-1).trim();
      
    //  ln -sfT "$udroot/$img_tag/ROOT" ./$arr[2]
    ln_sfT( rootfs , `./${link}`)
    ln_sfT( img_tag , `${udroot}/${link}`)
  }


  await runImg(img);

  try{

  jc = JSON.parse(
            fs.readFileSync(jsonFile).toString()
       );

  cfg = jc.config;

  wd = cfg.WorkingDir || "/";

  await fsp.mkdir(  path.join(rootfs,wd), 
                   { recursive: true }  );

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

export async function runImg(img,ctnName)
{
  ctnName = (ctnName || img_tag || 'null')+'';

  if(fs.existsSync(udroot + ctnName))
    csl("@@ Use existing container:",ctnName);
  else
  {

  let r=await new Promise(res=>{
  
    const p = spawn( prefix + "udocker",
      [
        "run","--platform=linux/arm64",
        "--entrypoint","/bin/sh",
        "--name=" + ctnName , img , "-c",
        "echo @@ Created new container: " + 
        ctnName
      ] , {
            stdio:"inherit",
            env:
            {
              ...process.env,
              PATH:"/data/data/com.termux/files/usr/bin:/system/bin:"+process.env.PATH,
              HOME:realhome 
            }
          }
    );

    p.on("error",res);
    p.on("close",res);
  
  });

  csl(r);

  } // else have not pulled img

}

var cpf_index=0

export async function COPY(str,lnn)
{
  csl('[COPY]',lnn)
  cse(str)

  cpf_index++;

  let cp_prefix="" ;

  let sarr=str.trim().split("\n");
  
  for(let i of sarr)
  {
    i=i.trim();
    if(i.endsWith("\\"))
      i=i.slice(0,-1).trim();

    let cp_from = i.match(/--from=[^ ]+/g)||[""];
    cp_from = cp_from[0].slice(7);

    if(cp_from)
    {
      if(fs.existsSync(cp_from))
        cp_prefix = "./"+cp_from ;
      else
      {
        let ctnName="tmp"+cpf_index+"-"+img_tag

        cse("\x1b[33m[Warning]\x1b[0m COPY from image directly is not well supported!")
        await runImg( cp_from, ctnName );
        cp_prefix=udroot+ctnName+"/ROOT/";
      }
    }

    let arr = i.split(/\s+/g)
               .filter(i=>!i.startsWith("-"));

    arr=arr.map(ii=>parseKeyval("p="+ii)[1]);

    // get abs path of target
    if(arr.at(-1).startsWith("/"))
      arr[arr.length-1]=path.join(rootfs,arr.at(-1));
    else
      arr[arr.length-1]=path.join(rootfs,wd,arr.at(-1));

    //  get right path of source
    for(let ii=0;ii<arr.length-1;ii++)
    {
      if(cp_prefix)
        arr[ii]=path.join(cp_prefix,arr[ii]);
    
      if(dexists(arr[ii]))
        arr[ii]+="/.";
    }
      

    let mdp;
    
    if(arr.length>2)
      mdp=arr.at(-1);
    else if(dexists(arr[0]))
      mdp=arr.at(-1);
    else
      mdp=path.dirname(arr.at(-1)) ;
      
    cse("Making folder:",mdp);

    await fsp.mkdir(mdp, { recursive: true });


    cse("cp",["-a",...arr]);

  
  if(!await nconfirm("copy"))
    return;


  let r=await new Promise(res=>{

    const p=
      spawn( "cp",["-a",...arr],
             {
               stdio:"inherit",
               env:
               {
                 ...process.env,
                 PATH:"/data/data/com.termux/files/usr/bin:/system/bin:"+process.env.PATH
               }
             } );

    p.on("error",res);
    p.on("close",res);

  });

  csl(r);

  

  } // multi lines of copy


}

var runcount=1;

export async function RUN(str,lnn)
{
  csl('[RUN]',lnn)
  

  let rpi="/build_script"+runcount+".sh";

  let rp=path.join(rootfs,rpi)

  runcount++;

  if(  (str+'').includes("python")||
       (str+'').includes("pip")  )
    str=`# python uses these 2 environment variables to detect android os
unset ANDROID_ROOT
unset ANDROID_DATA

`+str;


  cse(str)


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


    if(isTermux)
      var otherEnv=cfg.Env;
    else
      var otherEnv=[];


  let argsarr = [ "run", "--entrypoint", "env",
      img_tag,"env",...gb.args,...otherEnv,
      script_runner,rpi
  ]

  
  csl(prefix+"udocker",argsarr);



  if(!await nconfirm("run"))
    return;


  let r=await new Promise(res=>{
  
    const p=
      spawn( prefix + "udocker", argsarr,
        {
          stdio:"inherit",
          env:
          {
            ...process.env,
            PATH:"/data/data/com.termux/files/usr/bin:/system/bin:"+process.env.PATH,
            HOME:realhome
          }
        }  );

    p.on("error",res);
    p.on("close",res);
  
  });

  csl(r);

}

export function LABEL(str,lnn)
{
  csl('[LABEL]',lnn);
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

export async function WORKDIR(str,lnn)
{
  csl("[WORKDIR]",lnn);
  
  str=str.trim()

  str=parseKeyval("w="+str)[1];

  if(str.startsWith("/"))
    wd=str;
  else
    wd=path.join(wd,str);

  await fsp.mkdir( path.join(rootfs,wd),
                   { recursive: true } );

  cfg.WorkingDir=wd;

  writeConfig();

  csl("Changed cwd:",wd)

}

export async function ENV(str,lnn)
{
  csl('[ENV]',lnn);
  cse(str);
  

  if(!cfg.Env)
    cfg.Env=[];

  str.trim().split("\n").forEach(i=>{

    let r=parseKeyval(i);

    if(r)
    {
      process.env[ r[0] ] = r[1] ;

      cse("Set ENV pair:",r);

      let s=r.join("=");

      if(!cfg.Env.includes(s))
        cfg.Env.push(s);

    }

  });

  csl("Env:",cfg.Env);

  if(await nconfirm("set Env"))
    writeConfig();
}

export function ARG(str,lnn)
{
  csl('[ARG]',lnn);
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

export function CMD(str,lnn)
{
  csl("[CMD]",lnn);
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

export function ENTRYPOINT(str,lnn)
{
  csl("[ENTRYPOINT]",lnn);
  cse(str);

  str=str.trim();

  if(str.startsWith("["))
  {
    try{

    let arr=JSON.parse(str);

    if(Array.isArray(arr))
    {
      cfg.Entrypoint=arr;

      csl("Changed Entrypoint:",arr)

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
cmd_func.ENTRYPOINT=ENTRYPOINT


cmd_func.COPY=COPY
cmd_func.RUN=RUN
cmd_func.LABEL=LABEL

function hasdquoteInside(str,i)
{
  // if double quote is either inside the string
  //   or one-sided at the left or right only
  const c=str[i];
  if(c=='"')
  {
    if(i>0 && i<str.length-1)
      return true;
    else if(i==0 && str.slice(-1)!='"')
      return true;
    else if(i==str.length-1 && str[0]!='"')
      return true;
    else
      return false;
  }
}

export function parseKeyval(i)
{
    i=((i||'')+'').trim()
    
    if(!i) return "";
    
    let tind=i.indexOf("=");
    
    if(tind==-1)
    {
      tind=i.length
      i=i+'=$'+i
    }
    
      let val=i.slice(tind+1);

      if(val.endsWith("\\"))
        val=val.slice(0,-1).trim();
      

      let hasDollar=false;

      for(let i=0;i<val.length;i++)
      {if( val[i]=="`"|| 
          hasdquoteInside(val,i) ||
          ( val[i]=="$" && 
            ( val[i+1]=="$" || val[i+1]=="(" ) ) 
       ){
      
        val=compose_escape(val);
        hasDollar=true;
        break;
        
      }}


      if(!val.includes('"'))
      {
        val='"'+val+'"';
      }


      val=spawnSync('/bin/sh',['-c','printf "%s" '+val],{env:process.env}).stdout.toString().trim();

      if(hasDollar)
        val=compose_unescape(val);
      
      return [i.slice(0,tind) , val] ;
    

}

const randhead = "--"+crypto.randomUUID();

const compose_dollar_escape = 
          randhead+"-dol--";
const compose_subst_escape =
          randhead+"-sub--";
const compose_tic_escape =
          randhead+"-tic--";
const compose_dqt_escape =
          randhead+"-dqt--";

export function compose_escape(str)
{
  let out = ""
  for (let i = 0; i < str.length; i++) {
    if(str[i]=="`")
    {
      out += compose_tic_escape ;
      continue 
    }

    if(hasdquoteInside(str,i))
    {
      out += compose_dqt_escape ;
      continue
    }
  
    if (str[i] === "$") {
     if(str[i+1] === "$")
       out += compose_dollar_escape;
     else if(str[i+1] === "(")
       out += compose_subst_escape;
     else
     {
       out += "$" ;
       continue
     }
      i++
      continue
    }
  
    out += str[i]
  }
  return out;
}


export function compose_unescape(str)
{
  str=str.replaceAll(compose_tic_escape,   '`' )
         .replaceAll(compose_dollar_escape,'$' )
         .replaceAll(compose_subst_escape, '$(')
         .replaceAll(compose_dqt_escape, '"')
         
  return str;
}


export function writeConfig()
{
  Object.assign(jc.config,cfg);

  fs.writeFileSync(jsonFile,JSON.stringify(jc));

}

export async function nconfirm(action)
{
  let r;
  
  if(imode=='i')
  {
    if(!rl)
      rl = readline.createInterface({ 
        input: process.stdin, output: process.stdout 
      });
      
    csl(`Want to ${action} the above?`);
    csl("(Press Ctrl+C to Abort)")

    try{
    
      r = await rl.question("(y/yesall/N)");
      rl.close();
      rl=null;

    }catch(e){
      if(e.message.includes("Ctrl+"))
        process.exit(130);
    }
  }
  else
    r = imode ;

  r=(r+'').toLowerCase();

  if(r.includes("y"))
  {
    if(r.includes("yesall"))
    {
      cse("Subsequent commands will all be agreed!");
      imode=r;

      process.exitCode = 225 ; // b+y becomes yesall
    }
  
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
