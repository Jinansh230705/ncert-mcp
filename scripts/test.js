const { spawn } = require('child_process'); 
const child = spawn('bun', ['run', 'src/mcp.ts'], { cwd: 'c:\\Users\\Jinansh\\ncert-mcp\\mcp' }); 
child.stdout.on('data', d => console.log('OUT:', d.toString())); 
child.stderr.on('data', d => console.log('ERR:', d.toString())); 
child.stdin.write('{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}}\n'); 
setTimeout(() => child.kill(), 2000);
