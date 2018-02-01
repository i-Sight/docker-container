/*
 * THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED
 * WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
 * IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

'use strict';

var registry = require('docker-registry-server');
var path = require('path');
var fs = require('fs');
var forwarder = require('remote-forwarder');
var access = require('fs-access');

function configRegistry(config, logger) {

  var forward;

  var identities = [
    path.join(process.env.HOME, '.docker', 'machine', 'machines', 'default', 'id_rsa'),
    path.join(process.env.HOME, '.ssh', 'id_boot2docker')
  ];

  function identityFile(cb) {
    var identity = identities.shift()
    if (!identity) {
      return cb(new Error('no identity file'))
    }

    logger.debug({ file: identity }, 'checking identity file');

    access(identity, function(err) {
      if (err) {
        logger.log({ file: identity }, 'unable to load identity file for boot2docker')
        return identityFile(identities, cb)
      }

      cb(null, identity)
    })
  }

  function createTunnel(root, cb) {

    if (!config.noTunnel && process.env.DOCKER_HOST) {

      logger.debug('fetching identity file');
      identityFile(function(err, file) {
        if (err) {
          return cb(err)
        }

        var split = /tcp:\/\/([0-9.]+):([0-9]+)/g.exec(process.env.DOCKER_HOST);;
        var forwarderOpts = {
          user: 'docker',
          port: config.registryPort,
          identityFile: file,
          retries: 50,
          target: split[1]
        };

        forward = forwarder(forwarderOpts);

        logger.debug(forwarderOpts, 'setting up SSH tunnel');

        forward.once('connect', function() {
          logger.info(forwarderOpts, 'SSH tunnel setted up');
          service(root, cb);
        });

        forward.on('ssh error', function(line) {
          logger.error(forwarderOpts, line);
        });
        forward.on('reconnect failed', cb);

        forward.start();
      });
    }
    else {
      logger.debug('tunnel not needed');
      service(root, cb);
    }
  }

  /**
   * Starts the registry
   */
  function service(root, cb) {
    var registryPath = config.registryPath || path.join(root, 'registry');
    fs.mkdir(registryPath, function(err) {
      if (err && err.code !== 'EEXIST') {
        logger.error(err);
        return cb(err);
      }

      // swallow errors, it may exists
      var server = registry({
        dir: registryPath
      });

      server.on('error', function(err) {
        logger.error(err);
      });

      /*
      server.listen(config.registryPort, function(err) {
        logger.info({
          port: config.registryPort,
          path: registryPath
        }, 'registry started');

        if (typeof err === 'string') {
          // err will contains the ip
          // TODO remove me as https://github.com/mafintosh/root/issues/12 get fixes
          err = null;
        }

        if (cb) {
          cb(err, server);
        }
      });
      */
    });
  }

  return createTunnel;
}

module.exports = configRegistry;
