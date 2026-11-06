import { afterEach, describe, expect, it } from 'vitest'
import {
  collectDocumentSymbols,
  normalizeCodeLanguage,
  regexDocumentSymbols,
  setDocumentSymbolCollector,
} from '../utils/codeSymbols'

afterEach(() => setDocumentSymbolCollector(null))

describe('code outline regex fallback', () => {
  it('extracts top-level TypeScript declarations with line numbers', () => {
    const source = [
      "import { x } from './x'",
      '',
      'export interface User {',
      '  id: string',
      '}',
      '',
      'export class Store {',
      '  load() {}',
      '}',
      '',
      'export function loadUser(id: string): User {',
      '  return null as never',
      '}',
      '',
      'export const MAX = 10',
      '',
      'export type Id = string',
      '',
      'function outer() {',
      '  function nested() {}',
      '}',
    ].join('\n')

    expect(regexDocumentSymbols(source, 'typescript')).toEqual([
      { id: 'typescript:User:3', label: 'User', kind: 'interface', line: 3 },
      { id: 'typescript:Store:7', label: 'Store', kind: 'class', line: 7 },
      {
        id: 'typescript:loadUser():11',
        label: 'loadUser()',
        kind: 'function',
        line: 11,
      },
      { id: 'typescript:MAX:15', label: 'MAX', kind: 'const', line: 15 },
      { id: 'typescript:Id:17', label: 'Id', kind: 'type', line: 17 },
      { id: 'typescript:outer():19', label: 'outer()', kind: 'function', line: 19 },
    ])
  })

  it('handles typed consts, generic type aliases and namespaces', () => {
    const source = [
      'export const MAX: number = 10',
      'export type Id<T> = T',
      'export namespace NS {}',
    ].join('\n')

    expect(regexDocumentSymbols(source, 'typescript')).toEqual([
      { id: 'typescript:MAX:1', label: 'MAX', kind: 'const', line: 1 },
      { id: 'typescript:Id:2', label: 'Id', kind: 'type', line: 2 },
      { id: 'typescript:NS:3', label: 'NS', kind: 'type', line: 3 },
    ])
  })

  it('extracts top-level Rust declarations and skips methods inside impl blocks', () => {
    const source = [
      'use std::fmt;',
      '',
      'pub struct Server {',
      '    name: String,',
      '}',
      '',
      'pub enum Mode {',
      '    Fast,',
      '}',
      '',
      'pub trait Handler {',
      '    fn handle(&self);',
      '}',
      '',
      'impl Server {',
      '    pub fn new() -> Self {',
      '        Self { name: String::new() }',
      '    }',
      '}',
      '',
      'pub fn run(server: &Server) {}',
      '',
      'pub mod config {}',
      '',
      'pub const MAX: usize = 3;',
      '',
      'type Id = u64;',
    ].join('\n')

    expect(regexDocumentSymbols(source, 'rust')).toEqual([
      { id: 'rust:Server:3', label: 'Server', kind: 'class', line: 3 },
      { id: 'rust:Mode:7', label: 'Mode', kind: 'type', line: 7 },
      { id: 'rust:Handler:11', label: 'Handler', kind: 'interface', line: 11 },
      { id: 'rust:Server:15', label: 'Server', kind: 'class', line: 15 },
      { id: 'rust:run():21', label: 'run()', kind: 'function', line: 21 },
      { id: 'rust:config:23', label: 'config', kind: 'property', line: 23 },
      { id: 'rust:MAX:25', label: 'MAX', kind: 'const', line: 25 },
      { id: 'rust:Id:27', label: 'Id', kind: 'type', line: 27 },
    ])
  })

  it('extracts top-level Python definitions and assignments', () => {
    const source = [
      'import os',
      '',
      'MAX_SIZE = 10',
      '',
      'async def fetch(url):',
      '    x = 1',
      '    def inner():',
      '        pass',
      '',
      'class Client:',
      '    def method(self):',
      '        pass',
      '',
      'NAME: str = "x"',
      '',
      'TRIPLE = """',
      'def fake():',
      '"""',
    ].join('\n')

    expect(regexDocumentSymbols(source, 'python')).toEqual([
      { id: 'python:MAX_SIZE:3', label: 'MAX_SIZE', kind: 'const', line: 3 },
      { id: 'python:fetch():5', label: 'fetch()', kind: 'function', line: 5 },
      { id: 'python:Client:10', label: 'Client', kind: 'class', line: 10 },
      { id: 'python:NAME:14', label: 'NAME', kind: 'const', line: 14 },
      { id: 'python:TRIPLE:16', label: 'TRIPLE', kind: 'const', line: 16 },
    ])
  })

  it('extracts Go declarations, receiver methods and grouped const blocks', () => {
    const source = [
      'package main',
      '',
      'type Server struct {',
      '    name string',
      '}',
      '',
      'type Handler interface {',
      '    Handle()',
      '}',
      '',
      'func New() *Server {',
      '    return nil',
      '}',
      '',
      'func (s *Server) Start() {',
      '}',
      '',
      'const (',
      '    MaxSize = 10',
      '    MinSize = 1',
      ')',
      '',
      'var DefaultServer = New()',
      '',
      'type ID = int64',
    ].join('\n')

    expect(regexDocumentSymbols(source, 'go')).toEqual([
      { id: 'go:Server:3', label: 'Server', kind: 'class', line: 3 },
      { id: 'go:Handler:7', label: 'Handler', kind: 'interface', line: 7 },
      { id: 'go:New():11', label: 'New()', kind: 'function', line: 11 },
      { id: 'go:Server.Start():15', label: 'Server.Start()', kind: 'method', line: 15 },
      { id: 'go:MaxSize:19', label: 'MaxSize', kind: 'const', line: 19 },
      { id: 'go:MinSize:20', label: 'MinSize', kind: 'const', line: 20 },
      {
        id: 'go:DefaultServer:23',
        label: 'DefaultServer',
        kind: 'property',
        line: 23,
      },
      { id: 'go:ID:25', label: 'ID', kind: 'type', line: 25 },
    ])
  })

  it('normalizes language aliases and ignores unsupported languages', () => {
    expect(normalizeCodeLanguage('TSX')).toBe('typescript')
    expect(normalizeCodeLanguage('js')).toBe('javascript')
    expect(normalizeCodeLanguage('rs')).toBe('rust')
    expect(normalizeCodeLanguage('golang')).toBe('go')
    expect(normalizeCodeLanguage('css')).toBeNull()
    expect(collectDocumentSymbols('const x = 1', 'css')).toEqual([])
  })

  it('prefers a replaceable document-symbol collector when one is installed', () => {
    setDocumentSymbolCollector(() => [
      { id: 'provided:1', label: 'Provided', kind: 'class', line: 1 },
    ])
    expect(collectDocumentSymbols('fn main() {}', 'rust')).toEqual([
      { id: 'provided:1', label: 'Provided', kind: 'class', line: 1 },
    ])
  })

  it('returns an empty list when a supported file has no top-level declarations', () => {
    expect(regexDocumentSymbols('// only a comment\n', 'typescript')).toEqual([])
    expect(regexDocumentSymbols('', 'rust')).toEqual([])
  })
})
