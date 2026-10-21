-- Red de seguridad de Valeria: cada minuto revisa si Neuralpreneur recibió un
-- aviso y no contestó dentro del plazo (AI (Valeria) → "pasar a un operador
-- después de", 60 segundos por defecto). Si no contestó, la conversación vuelve
-- a los operadores y en el chat aparece un aviso rojo con el motivo.
--
-- Requiere: haber corrido neuralpreneur.sql y tener activa la extensión pg_cron
-- (Database > Extensions). Se puede correr más de una vez.

do $$
begin
  perform cron.unschedule('neural-watchdog');
exception when others then
  null;  -- todavía no estaba programado
end $$;

select cron.schedule(
  'neural-watchdog', '* * * * *',
  $job$ select net.http_post(
         url := (select rtrim(value, '/') from integration_settings where key = 'NEURAL_INTERNAL_URL') || '/functions/v1/ai-dispatch',
         headers := jsonb_build_object('Content-Type', 'application/json',
                    'x-internal-secret', (select value from integration_settings where key = 'NEURAL_INTERNAL_SECRET')),
         body := jsonb_build_object('watchdog', true),
         timeout_milliseconds := 5000) $job$
);

-- Ver que quedó programado:   select jobname, schedule, active from cron.job where jobname = 'neural-watchdog';
-- Para quitarlo:              select cron.unschedule('neural-watchdog');
