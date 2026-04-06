const http = require('http');
http.get('http://localhost:3000', res => {
  let body='';
  res.on('data', d => body += d.toString());
  res.on('end', () => { 
    console.log(body.slice(0,2000));
  });
}).on('error', e => console.error('ERR', e));
