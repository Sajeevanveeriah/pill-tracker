import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../inventory.mjs';
import * as S from '../storage.mjs';
function memory() { const data = new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}; }
test('empty browser storage is a valid empty stack', () => {const r=S.read(memory());assert.equal(r.state.medicines.length,0);assert.equal(r.raw,null);assert.equal(r.error,null);});
test('successful save round-trips and increases the revision', () => {const store=memory();const r=S.write(store,emptyState(),null);assert.equal(S.read(store).state.revision,1);assert.equal(S.read(store).raw,r.raw);});
test('a corrupted record is preserved and never silently reset', () => {const store=memory();store.setItem(S.KEY,'{broken');const r=S.read(store);assert.equal(r.state,null);assert.ok(r.error);assert.equal(store.getItem(S.KEY),'{broken');});
test('unsupported version is preserved for recovery', () => {const store=memory();const raw=JSON.stringify({...emptyState(),version:9});store.setItem(S.KEY,raw);assert.ok(S.read(store).error);assert.equal(store.getItem(S.KEY),raw);});
test('stale tabs cannot overwrite a more recent save', () => {const store=memory();S.write(store,emptyState(),null);assert.throws(()=>S.write(store,emptyState(),null),/another tab/i);});
test('failed storage writes do not report success', () => {const store={getItem:()=>null,setItem:()=>{throw new Error('quota');}};assert.throws(()=>S.write(store,emptyState(),null),/not saved/i);});
test('unavailable storage is surfaced rather than fabricated empty data', () => {const r=S.read({getItem:()=>{throw new Error('denied');}});assert.equal(r.state,null);assert.ok(r.error);});
test('silent write failures are detected', () => assert.throws(()=>S.write({getItem:()=>null,setItem:()=>{}},emptyState(),null),/not saved/i));
test('invalid state cannot replace valid stored data', () => {const store=memory();const r=S.write(store,emptyState(),null);assert.throws(()=>S.write(store,{...emptyState(),theme:'invalid'},r.raw));assert.equal(store.getItem(S.KEY),r.raw);});
test('JSON export round-trips without changing the payload', () => {const a=emptyState();assert.deepEqual(S.parseBackup(JSON.stringify(a)),a);});
test('oversized imports are rejected before parsing', () => assert.throws(()=>S.parseBackup(' '.repeat(1048577)),/1 MB/));
test('invalid JSON imports give a useful error', () => assert.throws(()=>S.parseBackup('{bad'),/valid JSON/));
