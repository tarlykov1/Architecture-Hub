import {expect,test} from '@playwright/test'
import {dependencyLayout,overviewGridPositions} from '../src/graphLayout'

test('dependency graph places consumers to the right of providers',()=>{
  const positions=dependencyLayout(['db','api','web'],[{source:'web',target:'api'},{source:'api',target:'db'}])
  expect(positions.web.x).toBeLessThan(positions.api.x)
  expect(positions.api.x).toBeLessThan(positions.db.x)
})
test('layout is stable under differing API ordering and handles a cycle',()=>{
  const links=[{source:'a',target:'b'},{source:'b',target:'a'}]
  expect(dependencyLayout(['b','a','c'],links)).toEqual(dependencyLayout(['c','a','b'],links))
  const result=dependencyLayout(['a','b','c'],links)
  for(const key of ['a','b','c'])expect(Number.isFinite(result[key].x+result[key].y)).toBe(true)
})
test('duplicate and unknown links do not shift position',()=>{
  const base=dependencyLayout(['a','b'],[{source:'a',target:'b'}])
  expect(dependencyLayout(['b','a'],[{source:'a',target:'b'},{source:'a',target:'b'},{source:'outside',target:'b'}])).toEqual(base)
})

test('high-level diagram uses the same readable grid as Overview',()=>{
  const ids=['one','two','three','four','five','six','seven']
  const positions=overviewGridPositions(ids)
  expect(positions.one).toEqual({x:0,y:0})
  expect(positions.three).toEqual({x:620,y:0})
  expect(positions.four).toEqual({x:0,y:170})
  expect(positions.seven).toEqual({x:0,y:340})
  expect(overviewGridPositions(['only']).only).toEqual({x:0,y:0})
})
