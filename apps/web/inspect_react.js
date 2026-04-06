const r = require('./node_modules/react');
console.log('typeof react:', typeof r);
console.log('has default?', Object.prototype.hasOwnProperty.call(r, 'default'));
console.log('keys:', Object.keys(r));
console.log('createContext type:', typeof r.createContext, 'default.createContext type:', r.default ? typeof r.default.createContext : 'no-default');
console.log('version:', r?.version);
