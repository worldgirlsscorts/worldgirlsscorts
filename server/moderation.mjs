import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function reviewReport(db,protocol,status,note,now=Date.now()){
  if(!['reviewing','resolved','dismissed'].includes(status))throw new Error('Use reviewing, resolved ou dismissed.');
  if(typeof note!=='string'||note.trim().length<10||note.length>1000)throw new Error('Registre uma justificativa entre 10 e 1.000 caracteres.');
  db.exec('BEGIN IMMEDIATE');
  try{
    const report=db.prepare('SELECT id FROM reports WHERE id=?').get(protocol);
    if(!report)throw new Error('Protocolo inexistente.');
    db.prepare('UPDATE reports SET status=?,updated_at=? WHERE id=?').run(status,now,protocol);
    db.prepare('INSERT INTO report_history VALUES(?,?,?,?,?)').run(randomUUID(),protocol,status,note.trim(),now);
    db.exec('COMMIT');return{protocol,status};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [action,protocol,status,...notes]=process.argv.slice(2);
  const filename=fileURLToPath(new URL('../data/sandbox.sqlite',import.meta.url));
  // Requires local filesystem access; no public moderation endpoint is exposed.
  const db=new DatabaseSync(filename,{readOnly:action==='list'});
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  try{
    if(action==='list')console.log(JSON.stringify(db.prepare("SELECT id AS protocol,profile_id AS profileId,reason,details,status,created_at AS createdAt FROM reports WHERE status IN ('received','reviewing') ORDER BY created_at LIMIT 100").all(),null,2));
    else if(action==='review')console.log(JSON.stringify(reviewReport(db,protocol,status,notes.join(' '))));
    else throw new Error('Uso: node server/moderation.mjs list | review PROTOCOLO STATUS JUSTIFICATIVA');
  }catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
}
