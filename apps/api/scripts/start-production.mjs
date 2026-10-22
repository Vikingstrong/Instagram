// Portable across developer OSes; production must never inherit dev cookie rules.
process.env.NODE_ENV = 'production';
await import('../dist/main.js');
