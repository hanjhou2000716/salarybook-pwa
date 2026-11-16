// This fixture is deliberately fictional and is generated only in memory.
export function createOcrSelfTestPages(){
  const makePage=role=>{
    const canvas=document.createElement('canvas');canvas.width=691;canvas.height=1536;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111';ctx.font='12px Arial';ctx.textBaseline='middle';
    const cell=(rect,value)=>{const [x0,y0,x1,y1]=rect,w=ctx.measureText(String(value)).width;ctx.fillText(String(value),x0+Math.max(1,(x1-x0-w)/2),(y0+y1)/2);};
    if(role==='income'){
      for(const y of [458,758,841]){ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(104,y);ctx.lineTo(588,y);ctx.stroke();}
      cell([414,250,454,267],'202506');
      const rows=[362,398,429,459,490,521,552,582,612,665,695,727],values=[['12345','647','1789','0','0','0','0','1500','0','0','0'],Array(11).fill('0'),Array(10).fill('0')],xs=[[222,263],[385,425],[546,584]];
      for(let col=0;col<3;col++)for(let row=0;row<values[col].length;row++)cell([xs[col][0],rows[row]+3,xs[col][1],rows[row+1]-3],values[col][row]);
      for(const [rect,value] of [[[514,288,583,308],'16281'],[[531,999,584,1024],'16281'],[[210,999,262,1024],'14781'],[[374,999,424,1024],'1500'],[[532,967,583,992],'0']])cell(rect,value);
    }else{
      ctx.strokeStyle='#111';ctx.lineWidth=2;for(const y of [266,311,433,464,538]){ctx.beginPath();ctx.moveTo(104,y);ctx.lineTo(588,y);ctx.stroke();}
      const xs=[[240,278],[403,439],[548,584]],rows=[8,7,7];for(let col=0;col<3;col++)for(let row=0;row<rows[col];row++)cell([xs[col][0],283+row*30.3,xs[col][1],308+row*30.3],'0');
      for(const [rect,value] of [[[532,540,584,563],'0'],[[197,1321,224,1336],'333'],[[317,1320,347,1337],'333'],[[446,1320,457,1337],'0']])cell(rect,value);
    }
    const data=canvas.toDataURL('image/png');return {name:`虛構自檢-${role}.png`,data,original:data,hash:`fictional-self-test-${role}`,pageId:`fictional-self-test-${role}`,originalPage:role==='income'?1:2,width:canvas.width,height:canvas.height,rotation:0,crop:[0,0,100,100]};
  };
  return [makePage('income'),makePage('deductions')];
}
