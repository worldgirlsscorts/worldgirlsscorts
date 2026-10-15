import {randomBytes, randomUUID, createHash, scryptSync} from 'node:crypto';
import {PaymentError} from './payments.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(condition,message,status=400)=>{if(condition)throw new PaymentError(message,status);};
export const REPORT_REASONS=['impersonation','unauthorized_image','underage','coercion','fraud','other'];

export function createSafety(db,clock){
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,receipt_hash TEXT UNIQUE NOT NULL,request_key TEXT UNIQUE NOT NULL,payload_hash TEXT NOT NULL,profile_id TEXT NOT NULL,reason TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'received',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS report_history(id TEXT PRIMARY KEY,report_id TEXT NOT NULL REFERENCES reports(id),status TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};

  function requestReset(email){
    fail(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email.trim()),'Informe um e-mail válido.');
    run('DELETE FROM password_resets WHERE expires_at<=?',clock());
    const user=get('SELECT id,email FROM users WHERE email=?',email.trim().toLowerCase());
    if(!user)return null;
    const token=randomBytes(32).toString('hex');
    transaction(()=>{run('DELETE FROM password_resets WHERE user_id=?',user.id);run('INSERT INTO password_resets VALUES(?,?,?)',hash(token),user.id,clock()+15*60000);});
    return{email:user.email,token,expiresAt:clock()+15*60000};
  }
  function cancelReset(token){run('DELETE FROM password_resets WHERE token_hash=?',hash(token));}
  function resetPassword({token,password}){
    fail(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token),'Link inválido ou expirado.');
    fail(typeof password!=='string'||password.length<12||password.length>128,'Use uma senha entre 12 e 128 caracteres.');
    const salt=randomBytes(16).toString('hex'),digest=scryptSync(password,salt,64).toString('hex');
    return transaction(()=>{
      const reset=get('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?',hash(token),clock());
      fail(!reset,'Link inválido ou expirado.');
      run('UPDATE users SET password=? WHERE id=?',salt+':'+digest,reset.user_id);
      run('DELETE FROM sessions WHERE user_id=?',reset.user_id);
      run('DELETE FROM password_resets WHERE user_id=?',reset.user_id);
      return{ok:true};
    });
  }
  function sessions(userId,currentToken){
    return all('SELECT token_hash,expires_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY expires_at DESC',userId,clock())
      .map(row=>({current:row.token_hash===hash(currentToken),expiresAt:row.expires_at}));
  }
  function revokeOthers(userId,currentToken){
    const result=run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',userId,hash(currentToken));
    return{ok:true,revoked:Number(result.changes)};
  }
  function createReport({profileId,reason,details,receipt},requestKey){
    fail(typeof profileId!=='string'||profileId.length>128||!profileId,'Perfil inválido.');
    fail(!REPORT_REASONS.includes(reason),'Escolha o motivo da denúncia.');
    fail(typeof details!=='string'||details.trim().length<10||details.length>2000,'Descreva o problema entre 10 e 2.000 caracteres.');
    fail(typeof receipt!=='string'||!/^[a-f0-9]{64}$/.test(receipt),'Comprovante inválido.');
    fail(typeof requestKey!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey),'Chave de idempotência inválida.');
    const payloadHash=hash(JSON.stringify({profileId,reason,details:details.trim(),receipt}));
    return transaction(()=>{
      const previous=get('SELECT id,payload_hash,status,created_at AS createdAt FROM reports WHERE request_key=?',requestKey);
      if(previous){fail(previous.payload_hash!==payloadHash,'Chave já utilizada com outra denúncia.',409);return{protocol:previous.id,status:previous.status,createdAt:previous.createdAt};}
      fail(!/^[1-8]$/.test(profileId)&&!get('SELECT id FROM profiles WHERE id=? AND deleted=0 AND age IS NOT NULL',profileId),'Perfil inexistente.',404);
      const id=randomUUID(),now=clock();
      run('INSERT INTO reports(id,receipt_hash,request_key,payload_hash,profile_id,reason,details,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,hash(receipt),requestKey,payloadHash,profileId,reason,details.trim(),now,now);
      run('INSERT INTO report_history VALUES(?,?,?,?,?)',randomUUID(),id,'received','Denúncia registrada. Aguarda revisão humana.',now);
      return{protocol:id,status:'received',createdAt:now};
    });
  }
  function reportStatus({protocol,receipt}){
    fail(typeof protocol!=='string'||protocol.length>64||typeof receipt!=='string'||!/^[a-f0-9]{64}$/.test(receipt),'Protocolo ou comprovante inválido.');
    const report=get('SELECT id,status,created_at AS createdAt,updated_at AS updatedAt FROM reports WHERE id=? AND receipt_hash=?',protocol,hash(receipt));
    fail(!report,'Protocolo ou comprovante inválido.',404);
    return{protocol:report.id,status:report.status,createdAt:report.createdAt,updatedAt:report.updatedAt};
  }
  return{requestReset,cancelReset,resetPassword,sessions,revokeOthers,createReport,reportStatus};
}
