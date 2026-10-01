// These test harnesses evaluate extracted production declarations in their lexical
// scope. ESLint cannot see references in the dynamic source. Keep the normal
// unused-variable rule and mark only the scopes actually visible to direct eval.
export default {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'eval') return;
        let scope = context.sourceCode.getScope(node);
        for (let lexical = scope; lexical; lexical = lexical.upper) {
          if (lexical.set.get('eval')?.defs.length) return; // A shadowed function is not direct eval.
        }
        while (scope && scope.type !== 'global') {
          for (const variable of scope.variables) if (variable.defs.length) context.sourceCode.markVariableAsUsed(variable.name, node);
          scope = scope.upper;
        }
      },
    };
  },
};
