import { readMailConfiguration } from './mail.config.js';
describe('Optional recovery mail configuration',()=>{
  it('starts development, tests and production with recovery disabled and no SMTP secrets',()=>{
    for(const NODE_ENV of ['development','test','production'])expect(readMailConfiguration({NODE_ENV})).toMatchObject({enabled:false,worker:false,host:'',key:undefined});
  });
  it('requires complete persistent SMTP configuration only when enabling recovery',()=>{
    const env={NODE_ENV:'production',MAIL_OUTBOX_KEY:'a'.repeat(64),PASSWORD_RECOVERY_ENABLED: 'true', SMTP_HOST:'smtp.example.test',SMTP_FROM:'sender@example.test'};
    expect(readMailConfiguration(env)).toMatchObject({enabled:true,worker:true,requireTLS:true});
    expect(readMailConfiguration({...env,SMTP_SECURE:'true'})).toMatchObject({secure:true,requireTLS:false});
    for(const change of [{MAIL_OUTBOX_KEY:''},{SMTP_HOST:''},{SMTP_FROM:''},{SMTP_PORT:'0'},{SMTP_USER:'user'},{SMTP_SECURE:'maybe'},{MAIL_WORKER_ENABLED:'maybe'}])expect(()=>readMailConfiguration({...env,...change})).toThrow();
    expect(readMailConfiguration({MAIL_WORKER_ENABLED:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1025'}).enabled).toBe(false);
  });
});
