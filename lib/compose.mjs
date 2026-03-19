#!/usr/bin/env node

import yaml from "js-yaml"
import repl from "node:repl";
import util from "node:util"
import fs from "node:fs"
import path from "node:path"
import child_process from "node:child_process"
import readline from "node:readline/promises"
var rl

import { parseKeyval } from "./build.mjs"


const spawn = child_process.spawn

const csl=console.log
const cse=console.error

const jss=JSON.stringify
const jsp=JSON.parse

const realhome = process.env.HOME ;

const udroot = realhome + "/.udocker/containers/";

const gb = {
  run_cmds:[],
  run_cmdso:[],
  build_cmds:[],
  hostnames:new Set()
};


export function loadYamlFile(fpath)
{
  return yaml.load(fs.readFileSync(fpath).toString())
}

export async function startCompose(fpath="compose.yaml")
{
  let yobj = loadYamlFile(fpath)

  gb.ctx = path.dirname(fs.realpathSync(fpath)) ;
  gb.vm_hosts = path.join(gb.ctx,"vm_hosts")
  
  gb.projName = yobj.name ||
                path.basename(gb.ctx)||
                "myproj" ;

  let intmode = "-i"
  
  if(process.argv.includes("-n"))
    intmode = "-n";
  else if(process.argv.includes("-y"))
    intmode = "-y";    


  yobj.services = sortComposeServices(yobj.services)
  
  
  for(let svcn in yobj.services)
  {
    let svc=yobj.services[svcn]

    cse(svcn,svc)

    svcn && gb.hostnames.add(svcn);
    svc.hostname && gb.hostnames.add(svc.hostname);
    
    svc.ctnName = gb.projName + "-" +
                  (svc.container_name || svcn)

    let run_cmd = [
      "run", 
      "-b", gb.vm_hosts+":/etc/hosts"
    ];

    let arr=parseEnvfile(".env");
    arr.forEach(i=>{
      let kv=i.split("=");
      if(process.env[kv[0]]==null)
        process.env[kv[0]]=kv[1]||"";
    })

    if(svc.environment)
    {
      if(!Array.isArray(svc.environment))
      {
        svc.environment = 
          Object.entries(svc.environment)
                .map(i=>i.join("="));
      }
    }
    else
      svc.environment=[];

    if(svc.env_file)
    {
      let arr=parseEnvfile(svc.env_file);
      svc.environment.unshift(...arr);
    }
    

    if(svc.environment)
    {
      for(let env of svc.environment)
      {
        let kv = parseKeyval(env);

        process.env[kv[0]] = kv[1] ;
        
        run_cmd.push("-e", kv.join("=") );
      }
    }

    svc.image=parseKeyval("i="+svc.image)[1]

    if(!fs.existsSync(udroot+svc.ctnName) ||
       process.argv.includes("--force-recreate"))
    {
      let build_cmd ;
      if(svc.build)
      {
        let dfarr=[];
        if(svc.build.dockerfile)
        {
          dfarr.push("-f",svc.build.dockerfile)
        }
      
        build_cmd=["build", intmode||"-y", "-t",
          svc.ctnName, ...dfarr
        ];

        if(svc.build.args)
        {
          const bargs=svc.build.args

          
        for(let argn in bargs)
        {
          let arg=bargs[argn];

          let kv

          if(Array.isArray(bargs))
            kv=parseKeyval(arg);
          else
            kv=parseKeyval(argn+"="+arg);

          build_cmd.push("--build-arg",kv.join("="))
        }

        
        }

        build_cmd.push(svc.build.context||svc.build)

      }
      else
      {
      
        build_cmd=["run","--name="+svc.ctnName,
          "--platform=linux/arm64",
          "--entrypoint","/bin/sh",
          svc.image,"-c",
          "echo Hello from: " + svc.ctnName
        ]

      }

      gb.build_cmds.push(build_cmd);
      //cse(build_cmd)
    }  //  if container not exist

    svc.volumes = svc.volumes || [] ;

    if(svc.secrets)
    {
      for(let sec of svc.secrets)
      {
        let gbsp=yobj.secrets?.[sec]?.file ||
                 yobj.secrets?.[sec] ;
        if(gbsp)
        {
          svc.volumes
             .push(gbsp+":/run/secrets/"+sec)
        }
      }
    }

    if(svc.volumes)
    {
      let tind=0
      for(let vol of svc.volumes)
      {if(vol){
        tind++;

        if( vol.type=="bind" ||
            vol.type=="volume" )
        {
          run_cmd.push("-v",
            vol.source+":"+vol.target
          );

        }
        else if(vol.type=="tmpfs")
        {
          run_cmd.push("-v",
            "tmpfs"+tind+"-"+svc.ctnName+
            ":"+vol.target
          );          
        }
        else
        {
          vol+="";
          if( vol.endsWith(":ro")||
              vol.endsWith(":rw") )
            vol=vol.slice(0,-3);

          if(!vol.includes(":"))
          {
            cse(`\x1b[33m[Warning]\x1b[0m Anonymous volumes are discouraged:
  ${vol}
  Converted to named volume.`);
            vol = "anony"+tind+"-"+
                  svc.ctnName+":"+vol;
          }
            
          run_cmd.push("-v",vol);
        }
      }}
    }

    
    if(svc.ports)
    {
      let kv=parseKeyval("p="+svc.ports[0])
      run_cmd.push("-p", kv[1] )
    }

    let run_cmdoo=run_cmd.slice();

    if(svc.entrypoint)
    {
      let a = parsetoArray(svc.entrypoint);
      run_cmd.push("--entrypoint",
        "@json:"+
        (JSON.stringify(a)))
    }

    run_cmdoo.push("--entrypoint=sh")

    run_cmd.push(svc.ctnName);
    
    run_cmdoo.push(svc.ctnName);
    run_cmdoo.push("-c","exec sh");
    
    gb.run_cmdso.push(run_cmdoo)


    if(svc.command)
    {
      let a = parsetoArray(svc.command);
      run_cmd.push(...a);
    }

    gb.run_cmds.push(run_cmd);

    //cse(run_cmd);
  }

  let vm_hosts_content = `
::1             ip6-localhost
127.0.0.1       localhost

`;

  vm_hosts_content += [...gb.hostnames]
              .map(i=>"127.0.0.1"+"       "+i)
              .join('\n')+"\n\n";

  cse("")
  cse("DNS hosts:",vm_hosts_content)

  fs.writeFileSync(gb.vm_hosts,vm_hosts_content)

  const robackup = gb.run_cmdso ;
  delete gb.run_cmdso ;
  cse("")


  if(process.argv.includes("--repl"))
  {
    
    csl("Entering js-udocker repl mode!");
    csl("  yobj = compose yaml object")
    csl("  svcs = yobj.services")
    csl("  Available shorthands: csl,cse,jsp,jss");
    csl("  Available variables:",Object.keys(gb).toString())
    
    const r = repl.start("jsu> ");
    
    Object.assign(r.context,
      { ...gb,csl,cse,yobj,svcs:yobj.services,
        jsp:JSON.parse,jss:JSON.stringify,
      }
    );
    return;
  }
  else if(process.argv.includes("--json"))
  {
    csl(JSON.stringify(gb,null,1));
  }
  else
  {
    cse("Project", util.inspect(gb, { depth: null, colors: true } ))
  }

  
  gb.run_cmdso = robackup

  if(process.argv.includes("--dry"))
    return;

  for(let bcmd of gb.build_cmds)
  {
    let r=await new Promise(res=>{

      let p;

      if(gb.yestoall)
      {
        let tind=bcmd.indexOf(intmode||"-y") ;
        bcmd[tind]="-y" ;
      }
      
      p = spawn( "udocker",bcmd,
            {
              stdio:"inherit",
              env:{
                ...process.env,
                PATH:"/data/data/com.termux/files/usr/bin:/system/bin:"+process.env.PATH,
                HOME:realhome
              }
            } );
      
    
      p.on("error",res);
      p.on("close",ecode=>{
        if(ecode==130)  //  ctrl+c
        {
          cse("build: Exited with Ctrl+C/D");
          process.exit(130);
        }
      
        if(ecode==225) // b+y = become yestoall
        {
          gb.yestoall=true;
        }
        res(ecode);
      });
    
    });
    
    csl(r);
  }


  if(process.argv.includes("--build-only"))
    return;


  let run_ind = -1 ;

  for(let rcmd of gb.run_cmds)
  {
    run_ind++;
   
    
      const p = spawn( "udocker",rcmd,
      {
        stdio:["ignore", "inherit","inherit"],
        env:{ ...process.env,
          PATH:"/data/data/com.termux/files/usr/bin:/system/bin:"+process.env.PATH,
          HOME:realhome
        }
      } );
    
      p.on("error",cse);
      p.on("close",csl);

    const service_start_delay=3000
    
    if(!rl)
      rl = readline.createInterface(
        { 
          input: process.stdin, 
          output: process.stdout
        }
      );

    await new Promise(
      res=>setTimeout( res , service_start_delay )
    );

    let r="";

    try{

      r = await rl.question("\x1b[31m ** If the previous service started successfully, please press Enter to continue, or type shell to enter that container **\x1b[0m") ;

    }catch(e){
      if(e.message.includes("Ctrl+"))
      {
        cse("Press Ctrl+C again to exit...");
        break;
      }
    }

    if( ((r||"")+"").trim().includes("shell") )
    {
      const rcmdo = gb.run_cmdso[run_ind] ;

      //csl(rcmdo); process.exit(0);
      rl.close();
      rl=null;
      
      let ps = spawn("udocker",rcmdo,{
        stdio:"inherit",env:{
          ...process.env,
          PATH:"/data/data/com.termux/files/usr/bin:/system/bin:"+process.env.PATH,
          HOME:realhome
        }
      });

      r = await new Promise(res=>{
        ps.on("error",res);
        ps.on("close",res);
      })

      csl(r)
    }


    if( run_ind == (gb.run_cmds.length-1) )
    {
      csl("\x1b[33m All containers up! \x1b[0m")
      csl("Quit by Ctrl+C * 2")
    }
    
  }

}

export function parseEnvfile(fpath)
{
  let epath=path.join(gb.ctx,fpath)
  
  if(fs.existsSync(epath))
  {
    let content=fs.readFileSync(epath).toString()
    if(content)
    {
      let arr=content.trim().split("\n")
              .filter(i=>{
                return i.trim() && !i.trim().startsWith("#");
              });
      return arr ;
    }
  }
  
  return [];
}

export function parsetoArray(poss)
{
  let a;
  
      if(Array.isArray(poss))
        a = poss ;
      else
      {
        cse(`\x1b[33m[Warning]\x1b[0m Shell-form command/entrypoint is not supported:
  ${poss}
  Falling back to naive whitespace split
  Please use exec/array form instead`);
      
        let c=poss+'';
        a=c.trim().split(/\s+/g);
      }

      a=a.map(i=>{
        let kv=parseKeyval("a="+i);
        return kv[1]||"";
      })

      return a ;
}


function sortComposeServices(services){

  const visited = new Set()
  const visiting = new Set()
  const result = []

  function visit(name){
  
    if (visited.has(name)) 
      return;
      
    if (visiting.has(name)) {
      cse("circular depends_on: " + name);
      return;
    }

    visiting.add(name)

    const svc = services[name]
    const deps = svc.depends_on

    const depList = Array.isArray(deps)
      ? deps
      : Object.keys(deps || {})

    for (const d of depList) {
      if (services[d]) visit(d)
    }

    visiting.delete(name)
    visited.add(name)

    result.push([name, svc])
  }

  for (const name of Object.keys(services)) {
    visit(name)
  }

  return Object.fromEntries(result)
}


await startCompose(process.argv[2]);
