// عدّاد الزوار: كل متصفح يُحسب مرة واحدة باليوم (بتوقيت فلسطين) على كل الموقع.
// يكتب في site_stats/total و site_stats/d_YYYY-MM-DD عبر Firestore REST (القواعد تسمح بزيادة 1 فقط).
(function(){
  try{
    if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname))return;
    var day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Gaza'}).format(new Date());
    if(localStorage.getItem('3engs_visit')===day)return;
    localStorage.setItem('3engs_visit',day);
    var base='projects/engs-website/databases/(default)/documents/site_stats/';
    var inc=function(id){return{transform:{document:base+id,fieldTransforms:[{fieldPath:'count',increment:{integerValue:'1'}}]}};};
    fetch('https://firestore.googleapis.com/v1/projects/engs-website/databases/(default)/documents:commit?key=AIzaSyALJiF8l_wnk_6FU6etQpz44Z43lSORXQk',
      {method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({writes:[inc('total'),inc('d_'+day)]})}).catch(function(){});
  }catch(e){}
})();
