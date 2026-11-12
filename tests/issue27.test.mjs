import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {watchOptions} from '../tools/lib/watch-options.mjs'

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whale-27-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  return {dir}
}
test('tile options do not consume positional output directory; invalid widths rejected',()=>{
  assert.deepEqual(watchOptions(['BVtest','--tile','800','4x4','out'],'default'),{bvid:'BVtest',grid:'4x4',outDir:'out',tile:800})
  assert.equal(watchOptions(['BVtest','--tile=1280'],'default').tile,1280)
  assert.equal(watchOptions(['BVtest'],'default').tile,720)
  for(const v of ['','NaN','239','1281','720.5'])assert.throws(()=>watchOptions(['BVtest','--tile='+v],'default'))
})
test('自定义 whale home（旧名 DSH_HOME）被 deps、notify、selftest 使用，不落到默认 .dsh',t=>{
  const f=fixture(t),dsh=path.join(f.dir,'custom-dsh');fs.mkdirSync(dsh)
  const env={...process.env,USERPROFILE:f.dir,HOME:f.dir,DSH_HOME:dsh,DSH_NODE:process.execPath,BILI_WHALE_CONFIG:'',NODE_OPTIONS:''}
  fs.writeFileSync(path.join(dsh,'bili-whale.config.json'),JSON.stringify({night:{windows:[{start:'20:00',end:'24:00'}]},notify:{type:'file'}}))
  fs.writeFileSync(path.join(dsh,'whale-night.json'),JSON.stringify({action:'wake',atMs:Date.now()+3600000}))
  const cli=fileURLToPath(new URL('../tools/bili.mjs',import.meta.url))
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{env,encoding:'utf8',timeout:30000})
  const deps=run('deps','--json');assert.equal(deps.error,undefined)
  assert.equal(JSON.parse(deps.stdout).items.find(i=>i.name==='生物钟').ok,true)
  const notice=run('notify','local path test');assert.equal(notice.status,0,notice.stderr)
  assert.match(fs.readFileSync(path.join(dsh,'whale-notify.log'),'utf8'),/local path test/)
  const self=run('selftest');assert.equal(self.error,undefined)
  assert.ok(self.stdout.split('\n').some(line=>line.includes('目录 whale home')&&line.includes(dsh)&&line.includes('✓')),self.stdout)
  assert.equal(fs.existsSync(path.join(f.dir,'.dsh')),false)
})
