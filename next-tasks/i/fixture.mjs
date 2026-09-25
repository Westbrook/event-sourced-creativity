// Agent-written adversarial draft. Proposed local study input, not user-authored fact or N4 response.
const fact = (block_id, text, intent = 'include', spatial_scope = {kind:'document'}, authority = 'authored') => ({block_id,type:'direction',role:'direction',intent,effect:intent==='prohibit'?'must_not_include':'shape_or_include',authority,active:true,properties:{text,weight:.8,authority,spatial_scope}});
export const snapshot = {
 document:{title:'Synthetic park bookstall'},
 facts:[
  fact('dog-a','A terrier in a green scarf leaps toward a bookstall as a pear falls. No tether is attached to this terrier.'),
  {...fact('dog-b','A second dog waits on the right, wearing its blue leash.'),type:'subject',role:'subject'},
  fact('local-no-red','red fabric','prohibit',{kind:'subject',subject_block_id:'dog-a',subject_relation:'inside',feather:0,falloff:'hard'}),
  fact('positive-red','A red cloth covers the right-hand table.','include',{kind:'region',region:'right'}),
  fact('quoted','The left card must read exactly “No leash required”. The quote is card text.'),
  fact('inferred','A brass bell could hang from the bookstall.','prefer',{kind:'region',region:'left'},'inferred'),
  {block_id:'group',type:'context',role:'context',properties:{text:'Bookstall only',weight:1,context_group:{name:'Bookstall only',role:'location',target:'bookstall',application:'isolate',relativity:1}}},
 ],
 relationships:[{from_block_id:'group',to_block_id:'positive-red',kind:'context_contains',properties:{member_order:0}}],
 pins:['dog-b'],standing_constraints:[{axis:'lighting',polarity:'include',value:'Cool morning light'}],
};
export const direction = {title:'Synthetic draft',rationale:'A comic jump beside books.',scene:'A terrier jumps toward books, with a taut tether at its collar. A second dog waits on the right. A brass bell hangs above the stall.',palette:['green','red','blue'],next_moves:['Keep both animals and flying books legible.','Keep the lead visible.']};
