// Ejecutor de comandos Cisco IOS linea a linea.
// Envia cada comando, espera el prompt (o responde preguntas conocidas) y se detiene ante errores.
// Opciones por paso:
//   timeout        inactividad maxima en ms (se reinicia con cada dato recibido)
//   answers        [{ pattern, reply, max }] respuestas a preguntas; max = usos permitidos
//   expectHostname solo acepta el prompt con ese hostname (evita falsos prompts en salidas largas)
//   errorScope     'head' revisa errores CLI solo en las primeras lineas (para show con banners)
(function (root) {
  const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
  const PROMPT_AT_END = /(?:^|[\r\n])([A-Za-z0-9._\-]+)(\([A-Za-z0-9._\-]+\))?([#>])[ \t]*$/;
  const PROMPT_LINE = /^([A-Za-z0-9._\-]+)(\([A-Za-z0-9._\-]+\))?([#>])\s*$/;
  const CLI_ERROR = /^\s*%\s*(Invalid|Incomplete|Ambiguous|Unknown|Unrecognized|Bad|Error)[^\r\n]*/mi;
  const MORE = /\s*--More--\s*$/;
  const ANY_QUESTION = /(\[(yes\/no|confirm|y\/n)\]|\?\s*\[[^\]]*\])\s*:?\s*$/i;

  class RunnerError extends Error {
    constructor(kind, message, output) {
      super(message);
      this.kind = kind;
      this.output = output || '';
    }
  }

  function defaultTimeout(command) {
    if (/^\s*crypto key generate/i.test(command)) return 120000;
    if (/^\s*(write|copy)\b/i.test(command)) return 60000;
    return 15000;
  }

  function parsePrompt(match) {
    return {
      hostname: match[1],
      mode: match[2] ? match[2].slice(1, -1) : '',
      privileged: match[3] === '#'
    };
  }

  function lastLine(text) {
    const lines = text.split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
    return lines[lines.length - 1] || '';
  }

  function create({ write, subscribe }) {
    let busy = false;
    let abortCurrent = null;

    function execute(step) {
      const command = step.command;
      const answers = step.answers || [];
      const answerUses = answers.map(() => 0);
      const timeout = step.timeout || defaultTimeout(command);
      // 'head': IOS muestra el error justo despues del eco (y del marcador ^); el resto puede ser contenido (banners).
      const headLines = (text) => text.split(/\r?\n|\r/).filter((line) => line.trim()).slice(0, 4).join('\n');
      const findCliError = (text) => (step.errorScope === 'head' ? headLines(text) : text).match(CLI_ERROR);

      return new Promise((resolve, reject) => {
        let full = '';
        let pending = '';
        let settled = false;

        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          abortCurrent = null;
          if (error) reject(error);
          else resolve(result);
        };

        const evaluate = () => {
          if (MORE.test(pending)) {
            pending = '';
            write(' ');
            return;
          }

          for (let index = 0; index < answers.length; index += 1) {
            const answer = answers[index];
            if (!answer.pattern.test(pending)) continue;
            if (answerUses[index] >= (answer.max || Infinity)) {
              finish(new RunnerError('rejected', `El equipo repitio la pregunta "${lastLine(pending)}" (respuesta rechazada).`, full));
              return;
            }
            answerUses[index] += 1;
            pending = '';
            write(answer.reply);
            return;
          }

          if (ANY_QUESTION.test(pending)) {
            finish(new RunnerError('question', `Pregunta no prevista del equipo: "${lastLine(pending)}"`, full));
            return;
          }

          const promptMatch = pending.match(PROMPT_AT_END);
          if (!promptMatch) return;
          if (step.expectHostname && promptMatch[1] !== step.expectHostname) return;

          const cliError = findCliError(full);
          if (cliError) {
            finish(new RunnerError('cli', cliError[0].trim(), full));
            return;
          }
          finish(null, { command, output: full, prompt: parsePrompt(promptMatch) });
        };

        const onTimeout = () => {
          // Prompt seguido de mensajes asincronos (syslog): se acepta si existe una linea de prompt.
          const lines = pending.split(/\r?\n|\r/).map((line) => line.trim());
          const promptLine = lines.slice(1).reverse().find((line) => {
            const match = line.match(PROMPT_LINE);
            return match && (!step.expectHostname || match[1] === step.expectHostname);
          });
          if (promptLine && !findCliError(full)) {
            finish(null, { command, output: full, prompt: parsePrompt(promptLine.match(PROMPT_LINE)) });
            return;
          }
          finish(new RunnerError('timeout', `Sin respuesta del equipo durante ${Math.round(timeout / 1000)} s.`, full));
        };
        let timer = setTimeout(onTimeout, timeout);

        const unsubscribe = subscribe((chunk) => {
          const clean = String(chunk).replace(ANSI, '');
          full += clean;
          pending += clean;
          clearTimeout(timer);
          timer = setTimeout(onTimeout, timeout);
          evaluate();
        });

        abortCurrent = (reason) => finish(new RunnerError('aborted', reason, full));
        write(`${command}\r`);
      });
    }

    async function run(steps, options = {}) {
      if (busy) throw new RunnerError('busy', 'Ya hay un envio en curso.');
      busy = true;
      const results = [];
      try {
        for (let index = 0; index < steps.length; index += 1) {
          const step = typeof steps[index] === 'string' ? { command: steps[index] } : steps[index];
          if (options.onProgress) options.onProgress(index, steps.length, step);
          try {
            results.push(await execute(step));
          } catch (error) {
            error.index = index;
            error.step = step;
            throw error;
          }
        }
        return results;
      } finally {
        busy = false;
      }
    }

    function abort(reason) {
      if (abortCurrent) abortCurrent(reason || 'Envio detenido.');
    }

    return {
      run,
      abort,
      get busy() {
        return busy;
      }
    };
  }

  const api = { create, RunnerError, defaultTimeout };
  root.CiscoRunner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
