import ts from 'typescript';

/** Complete an extracted class with its actual private dependencies. Explicit
 * fixture ports win. Never invent no-op guards or copy production method bodies. */
export function completeClassFixture(sourceTree, ownerName, fixture) {
  const owner=sourceTree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===ownerName);
  if(!owner)throw Error(`Missing production class ${ownerName}`);
  const actual=new Map(owner.members.filter(node=>node.name).map(node=>[node.name.getText(sourceTree),node]));
  let result=fixture;
  for(let pass=0;pass<=actual.size;pass++){
    const tree=ts.createSourceFile('fixture.ts',result,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    let declaration;
    function find(node){if(!declaration&&(ts.isClassDeclaration(node)||ts.isClassExpression(node)))declaration=node;else if(!declaration)ts.forEachChild(node,find);}
    find(tree);if(!declaration)throw Error('Fixture must contain one class');
    const declared=new Set(declaration.members.filter(node=>node.name).map(node=>node.name.getText(tree))),missing=new Set();
    function visit(node){if(ts.isPrivateIdentifier(node)&&!declared.has(node.text))missing.add(node.text);ts.forEachChild(node,visit);}
    visit(declaration);if(!missing.size)return result;
    const additions=[...missing].map(name=>{const node=actual.get(name);if(!node)throw Error(`Unknown private fixture dependency ${name}`);return node.getText(sourceTree);}).join('\n');
    const end=declaration.end-1;result=result.slice(0,end)+'\n'+additions+'\n'+result.slice(end);
  }
  throw Error('Private fixture dependency closure did not converge');
}
