#!/usr/bin/env node

import yaml from "js-yaml"
import fs from "node:fs"
import path from "node:path"
import child_process from "node:child_process"
import readline from "node:readline/promises"
var rl

const spawn = child_process.spawn

const csl=console.log
const cse=console.error

const jss=JSON.stringify
const jsp=JSON.parse

const udroot=process.env.HOME+"/.udocker/containers/";

const gb = {
  run_cmds:[],
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
  
  for(let svcn in yobj.services)
  {
    let svc=yobj.services[svcn]

    csl(svcn,svc)

    svcn && gb.hostnames.add(svcn);
    svc.hostname && gb.hostnames.add(svc.hostname);
    
    svc.ctnName = gb.projName + "-" +
                  (svc.container_name || svcn)


    if(!fs.existsSync(udroot+svc.ctnName))
    {
      let build_cmd ;
      if(svc.build)
      {
        build_cmd=["build", intmode||"-y", "-t",
          svc.ctnName,svc.build?.context||svc.build
        ];

      }
      else
      {
        build_cmd=["run","--name="+svc.ctnName,
          svc.image,"echo","Pulled "+svc.image
        ]

      }

      gb.build_cmds.push(build_cmd);
      //csl(build_cmd)
    }  //  if container not exist

    let run_cmd = [
      "run", 
      "-b", gb.vm_hosts+":/etc/hosts"
    ];

    if(svc.volumes)
    {
      for(let vol of svc.volumes)
        run_cmd.push("-v",vol);
    }

    if(svc.ports)
    {
      run_cmd.push("-p",svc.ports[0])
    }

    run_cmd.push(svc.ctnName);

    gb.run_cmds.push(run_cmd);

    //csl(run_cmd);
  }

  let vm_hosts_content = `
::1             ip6-localhost
127.0.0.1       localhost

`;

  vm_hosts_content += [...gb.hostnames]
              .map(i=>"127.0.0.1"+"       "+i)
              .join('\n')+"\n\n";

  csl("")
  cse("DNS hosts:",vm_hosts_content)

  fs.writeFileSync(gb.vm_hosts,vm_hosts_content)
  
  csl("")
  cse("Project", gb)

  //return

  for(let bcmd of gb.build_cmds)
  {
    let r=await new Promise(res=>{
    
      const p = spawn( "udocker",bcmd,
        {stdio:"inherit",env:process.env} );
    
      p.on("error",res);
      p.on("close",res);
    
    });
    
    csl(r);
  }

  for(let rcmd of gb.run_cmds)
  {
    //let r=await new Promise(res=>{
    
      const p = spawn( "udocker",rcmd,
      {
        stdio:["ignore", "inherit","inherit"],
        env:process.env
      } );
    
      p.on("error",cse);
      p.on("close",csl);
    
    //});

    if(!rl)
      rl = readline.createInterface(
            { 
              input: process.stdin, 
              output: process.stdout
            }
           );

    await new Promise(res=>setTimeout(res,2000));

    await rl.question("\x1b[31m ** If the previous service started successfully, please press Enter to continue **\x1b[0m")
    //csl(r);
  }

}

await startCompose(process.argv[2]);
