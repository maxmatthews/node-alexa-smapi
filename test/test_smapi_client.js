/* eslint-env mocha */
'use strict';

/*
 * Configurable test suite parameters
 */
const LOG_RESPONSES = false; // if true will output (console.log) the response received by each SMAPI operation
const LOG_ERRORS = true; // if true will output (console.log) any unexpected response received from SMAPI
const MAX_RETRIES = 10; // number of times the test suite will check for completion of create/update operations before proceeding with other test cases
const RETRY_TIMEOUT = 10000; // time (in milliseconds) to wait before checking again for completion of create/update operations
const WITHDRAWAL_TIMEOUT = 1 * 60 * 1000; // time (in milliseconds) to wait before withdrawing skill from certification
const MOCHA_TIMEOUT = WITHDRAWAL_TIMEOUT + 10000; // for details see https://mochajs.org/#timeouts
const TEST_CERTIFICATION = true; // if true will run the Skill Certification test cases (adds a tens of minutes to this test run)

var chai = require('chai');
var chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
var expect = chai.expect;
chai.config.includeStack = true;

const VERSION_0 = 'v0';
const VERSION_1 = 'v1';
const SUPPORTED_VERSIONS = [VERSION_0, VERSION_1];
const SKILL_READY = {
  v0: 'SUCCESSFUL',
  v1: 'SUCCEEDED'
};
const MODEL_READY = {
  v0: 'SUCCESS',
  v1: 'SUCCEEDED'
};
var testData = require('./data/common');

function showResponse(response) {
  if (LOG_RESPONSES) console.log(JSON.stringify(response, null, ' ')); // eslint-disable-line no-console
}

function showError(error) {
  if (LOG_ERRORS) console.log(JSON.stringify(error, null, ' ')); // eslint-disable-line no-console
}

function errorSummary(error) {
  const summary = {
    status: error.status,
    statusText: error.statusText,
    data: error.data
  };
  return summary;
}

var sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function retry(error) {
  const summary = errorSummary(error);
  if (summary.status === 429) {
    console.log(`---> Operation status: ${summary.status} (${summary.data.message}) - will sleep for ${RETRY_TIMEOUT/1000}s & retry <---`); // eslint-disable-line no-console
    return sleep(RETRY_TIMEOUT).then((summary) => {
      return summary;
    });
  } else {
    showError(summary);
    return summary;
  }
}

function waitOnCertification(error) {
  const summary = errorSummary(error);
  if (summary.status !== 200) {
    showError(summary);
    console.log(`---> Operation status: ${summary.status} (${summary.data.message}) - will sleep for ${WITHDRAWAL_TIMEOUT/1000}s & retry <---`); // eslint-disable-line no-console
    return sleep(WITHDRAWAL_TIMEOUT).then((summary) => {
      return summary;
    });
  } else return summary;
}

SUPPORTED_VERSIONS.forEach(function(TEST_VERSION) {

  function waitOnSkill(response) {
    showResponse(response);
    var status;
    if (TEST_VERSION === VERSION_0) status = response.manifest.lastModified.status;
    else if (TEST_VERSION === VERSION_1) status = response.manifest.lastUpdateRequest.status;
    if (status !== SKILL_READY[TEST_VERSION]) {
      console.log(`---> Skill building: ${status} - will sleep for ${RETRY_TIMEOUT/1000}s & retry <---`); // eslint-disable-line no-console
      return sleep(RETRY_TIMEOUT).then((response) => {
        return response;
      });
    } else {
      console.log(`---> Skill building: ${status} <---`); // eslint-disable-line no-console
      return response;
    }
  }

  function waitOnModel(response) {
    showResponse(response);
    var status;
    if (TEST_VERSION === VERSION_0) status = response.status;
    else if (TEST_VERSION === VERSION_1) {
      status = response.interactionModel[testData.locale].lastUpdateRequest.status;
      delete response.interactionModel[testData.locale].eTag;
    }
    if (status !== MODEL_READY[TEST_VERSION]) {
      console.log(`---> Model building: ${status} - will sleep for ${RETRY_TIMEOUT/1000}s & retry <---`); // eslint-disable-line no-console
      return sleep(RETRY_TIMEOUT).then((response) => {
        return response;
      });
    } else {
      console.log(`---> Model building: ${status} <---`); // eslint-disable-line no-console
      return response;
    }
  }

  describe('Testing with SMAPI ' + TEST_VERSION, function() {
    this.slow(1500);
    this.retries(MAX_RETRIES);
    this.timeout(MOCHA_TIMEOUT);
    const smapiClient = require('../index')({
      version: TEST_VERSION
    });

    context('-> Token Management', function() {
      describe('-> refresh token', function() {
        var subject;

        beforeEach(function() {
          subject = testData.accessToken = smapiClient.tokens.refresh({
            refreshToken: testData.refreshToken,
            clientId: testData.clientId,
            clientSecret: testData.clientSecret,
          });
        });

        it('responds with access_token and sets token for future SMAPI calls', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            testData.accessToken = response.access_token;
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('access_token');
        });
      });
    });

    context('-> Vendor Operations', function() {
      describe('-> Get Vendor List', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.vendors.list();
        });

        it('responds with vendors array', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            testData.vendorId = response.vendors[0].id;
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('vendors');
        });
      });
    });

    context('-> Skill Operations (except delete)', function() {
      describe('-> Create a skill', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skills.create(testData.vendorId, testData[TEST_VERSION].skillManifest);
        });

        it('responds with skillId', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            testData.skillId = response.skillId;
            return response;
          }, retry);
          return Promise.all([
            expect(subject).to.eventually.have.property('skillId'),
            expect(subject).to.eventually.have.property('location')
          ]);
        });
      });

      describe('-> List skills (first set)', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skills.list(testData.vendorId, 10);
        });

        it('responds with list of skills', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return Promise.all([
            expect(subject).to.eventually.have.property('_links'),
            expect(subject).to.eventually.have.property('isTruncated'),
            expect(subject).to.eventually.have.property('skills')
          ]);
        });
      });

      describe('-> Get the status of a skill (and wait for changes to finish)', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skills.status(testData.skillId);
        });

        it('responds with skill status', function() {
          subject = subject.then(waitOnSkill, retry);
          if (TEST_VERSION === VERSION_0) return expect(subject).to.eventually.have.nested.property('manifest.lastModified.status', SKILL_READY[TEST_VERSION]);
          else if (TEST_VERSION === VERSION_1) return expect(subject).to.eventually.have.nested.property('manifest.lastUpdateRequest.status', SKILL_READY[TEST_VERSION]);
        });
      });

      describe('-> Get Skill Information', function() {
        var subject;

        beforeEach(function() {
          if (TEST_VERSION === VERSION_0) subject = smapiClient.skills.getManifest(testData.skillId);
          else if (TEST_VERSION === VERSION_1) subject = smapiClient.skills.getManifest(testData.skillId, testData.stage);
        });

        it('responds with skill manifest', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          if (TEST_VERSION === VERSION_0) return expect(subject).to.eventually.have.property('skillManifest');
          else if (TEST_VERSION === VERSION_1) return expect(subject).to.eventually.have.property('manifest');
        });
      });

      describe('-> Update an existing skill', function() {
        var subject;

        beforeEach(function() {
          if (TEST_VERSION === VERSION_0) subject = smapiClient.skills.update(testData.skillId, testData[TEST_VERSION].skillManifest);
          else if (TEST_VERSION === VERSION_1) subject = smapiClient.skills.update(testData.skillId, testData.stage, testData[TEST_VERSION].skillManifest);
        });

        it('responds with skill manifest', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return Promise.all([
            expect(subject).to.eventually.have.property('location'),
            expect(subject).to.eventually.have.property('etag')
          ]);
        });
      });

      describe('-> Get the status of a skill (and wait for changes to finish)', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skills.status(testData.skillId);
        });

        it('responds with skill status', function() {
          subject = subject.then(waitOnSkill, retry);
          if (TEST_VERSION === VERSION_0) return expect(subject).to.eventually.have.nested.property('manifest.lastModified.status', SKILL_READY[TEST_VERSION]);
          else if (TEST_VERSION === VERSION_1) return expect(subject).to.eventually.have.nested.property('manifest.lastUpdateRequest.status', SKILL_READY[TEST_VERSION]);
        });
      });
    });

    context('-> Interaction Model Operations', function() {
      describe('-> Update Interaction Model', function() {
        var subject;

        beforeEach(function() {
          if (TEST_VERSION === VERSION_0) subject = smapiClient.interactionModel.update(testData.skillId, testData.locale, testData[TEST_VERSION].interactionModel);
          else if (TEST_VERSION === VERSION_1) subject = smapiClient.interactionModel.update(testData.skillId, testData.stage, testData.locale, testData[TEST_VERSION].interactionModel);
        });

        it('responds with interaction model location', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return Promise.all([
            expect(subject).to.eventually.have.property('location'),
            expect(subject).to.eventually.have.property('etag')
          ]);
        });
      });

      describe('-> Get the Interaction Model Building Status', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.interactionModel.getStatus(testData.skillId, testData.locale);
        });

        it('responds with interaction model status', function() {
          subject = subject.then(waitOnModel, retry);
          if (TEST_VERSION === VERSION_0) return expect(subject).to.eventually.have.property('status', MODEL_READY[TEST_VERSION]);
          else if (TEST_VERSION === VERSION_1) return expect(subject).to.eventually.become({
            'interactionModel': {
              'en-US': {
                'lastUpdateRequest': {
                  'status': MODEL_READY[TEST_VERSION]
                }
              }
            }
          });
        });
      });

      describe('-> Head Interaction Model', function() {
        var subject;

        beforeEach(function() {
          if (TEST_VERSION === VERSION_0) subject = smapiClient.interactionModel.getEtag(testData.skillId, testData.locale);
          else if (TEST_VERSION === VERSION_1) subject = smapiClient.interactionModel.getEtag(testData.skillId, testData.stage, testData.locale);
        });

        it('responds with etag', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('etag');
        });
      });

      describe('-> Get Interaction Model', function() {
        var subject;

        beforeEach(function() {
          if (TEST_VERSION === VERSION_0) subject = smapiClient.interactionModel.get(testData.skillId, testData.locale);
          else if (TEST_VERSION === VERSION_1) subject = smapiClient.interactionModel.get(testData.skillId, testData.stage, testData.locale);
        });

        it('responds with interaction model for ' + testData.locale, function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('interactionModel');
        });
      });
    });

    context('-> Account Linking Operations', function() {
      describe('-> Update Account Linking', function() {
        var subject;

        beforeEach(function() {
          if (TEST_VERSION === VERSION_0) subject = smapiClient.accountLinking.update(testData.skillId, testData[TEST_VERSION].accountLinkingRequest);
          else if (TEST_VERSION === VERSION_1) subject = smapiClient.accountLinking.update(testData.skillId, testData.stage, testData[TEST_VERSION].accountLinkingRequest);
        });

        it('responds with etag', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('etag');
        });
      });

      describe('-> Read Account Linking Info', function() {
        var subject;

        beforeEach(function() {
          if (TEST_VERSION === VERSION_0) subject = smapiClient.accountLinking.readInfo(testData.skillId);
          else if (TEST_VERSION === VERSION_1) subject = smapiClient.accountLinking.readInfo(testData.skillId, testData.stage);
        });

        it('responds with etag & accountLinkingResponse', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('accountLinkingResponse');
        });
      });

      if (TEST_VERSION === VERSION_1) describe('-> Delete Account Linking', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.accountLinking.delete(testData.skillId, testData.stage);
        });

        it('responds with no content', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.be.empty;
        });
      });
    });

    context('-> Skill Enablement Operations', function() {
      describe('-> Enable a skill', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skillEnablement.enable(testData.skillId, testData.stage);
        });

        it('responds with no content', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.be.deep.equal({
            location: undefined,
            etag: undefined
          });
        });
      });

      describe('-> Check enablement status of a skill', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skillEnablement.status(testData.skillId, testData.stage);
        });

        it('responds with no content', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.be.empty;
        });
      });

      describe('-> Disable a skill', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skillEnablement.enable(testData.skillId, testData.stage);
        });

        it('responds with no content', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.be.deep.equal({
            location: undefined,
            etag: undefined
          });
        });
      });
    });

    context('-> Skill Testing Operations', function() {
      if (TEST_VERSION === VERSION_1) describe('-> Validate a skill', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skillTesting.validate(testData.skillId, testData.stage, testData.locales);
        });

        it('responds with validationId', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            testData.validationId = response.id;
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('id');
        });
      });

      if (TEST_VERSION === VERSION_1) describe('-> Check validation status of a skill', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skillTesting.validationStatus(testData.skillId, testData.stage, testData.validationId);
        });

        it('responds with no content', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('status');
        });
      });
    });

    context('-> Custom Operations', function() {
      describe('-> head() - Head Interaction Model', function() {
        var subject;

        beforeEach(function() {
          const url = {
            v0: `/v0/skills/${testData.skillId}/interactionModel/locales/${testData.locale}`,
            v1: `/v1/skills/${testData.skillId}/stages/${testData.stage}/interactionModel/locales/${testData.locale}`
          };
          subject = smapiClient.custom.head(url[TEST_VERSION]);
        });

        it('responds with etag', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('etag');
        });
      });

      describe('-> post() & put() - Update Interaction Model', function() {
        var subject;

        beforeEach(function() {
          const url = {
            v0: `/v0/skills/${testData.skillId}/interactionModel/locales/${testData.locale}`,
            v1: `/v1/skills/${testData.skillId}/stages/${testData.stage}/interactionModel/locales/${testData.locale}`
          };
          if (TEST_VERSION === VERSION_0) subject = smapiClient.custom.post(url[TEST_VERSION], { interactionModel: testData[TEST_VERSION].interactionModel });
          else if (TEST_VERSION === VERSION_1) subject = smapiClient.custom.put(url[TEST_VERSION], { interactionModel: testData[TEST_VERSION].interactionModel });
        });

        it('responds with interaction model location', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return Promise.all([
            expect(subject).to.eventually.have.property('location'),
            expect(subject).to.eventually.have.property('etag')
          ]);
        });
      });

      describe('-> get() - Get the Interaction Model Building Status', function() {
        var subject;

        beforeEach(function() {
          const url = {
            v0: `/v0/skills/${testData.skillId}/interactionModel/locales/${testData.locale}/status`,
            v1: `/v1/skills/${testData.skillId}/status?resource=interactionModel`
          };
          subject = smapiClient.custom.get(url[TEST_VERSION]);
        });

        it('responds with interaction model status', function() {
          subject = subject.then(waitOnModel, retry);
          if (TEST_VERSION === VERSION_0) return expect(subject).to.eventually.have.property('status', MODEL_READY[TEST_VERSION]);
          else if (TEST_VERSION === VERSION_1) return expect(subject).to.eventually.become({
            'interactionModel': {
              'en-US': {
                'lastUpdateRequest': {
                  'status': MODEL_READY[TEST_VERSION]
                }
              }
            }
          });
        });
      });

      describe('-> put() - Update Account Linking', function() {
        var subject;

        beforeEach(function() {
          const url = {
            v0: `/v0/skills/${testData.skillId}/accountLinkingClient`,
            v1: `/v1/skills/${testData.skillId}/stages/${testData.stage}/accountLinkingClient`
          };
          subject = smapiClient.custom.put(url[TEST_VERSION], { accountLinkingRequest: testData[TEST_VERSION].accountLinkingRequest });
        });

        it('responds with etag', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('etag');
        });
      });

      if (TEST_VERSION === VERSION_1) describe('-> delete() - Delete Account Linking', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.custom.delete(`/v1/skills/${testData.skillId}/stages/${testData.stage}/accountLinkingClient`);
        });

        it('responds with no content', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.be.empty;
        });
      });
    });

    if (TEST_CERTIFICATION) context('-> Skill Certification Operations', function() {
      describe('-> Submit a skill for certification', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skillCertification.submit(testData.skillId);
        });

        it('responds with location', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.have.property('location');
        });
      });

      if (TEST_VERSION === VERSION_1) describe('-> Check skill certification status', function() {
        // Location returned by v0 is not usable
        var subject;

        beforeEach(function() {
          subject = smapiClient.skillCertification.status(testData.vendorId, testData.skillId);
        });

        it('responds with publicationStatus', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response.skills[0];
          }, retry);
          return Promise.all([
            expect(subject).to.eventually.have.property('publicationStatus', 'CERTIFICATION'),
            expect(subject).to.eventually.have.property('skillId', testData.skillId),
            expect(subject).to.eventually.have.property('stage', testData.stage)
          ]);
        });
      });

      describe('-> Withdraw a skill from certification', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skillCertification.withdraw(testData.skillId, testData.reason, testData.message);
        });

        it('responds with no content', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, waitOnCertification);
          return Promise.all([
            expect(subject).to.become({
              etag: undefined,
              location: undefined
            }),
          ]);
        });
      });
    });

    context('-> Skill Operations (delete only)', function() {
      describe('-> Delete a skill', function() {
        var subject;

        beforeEach(function() {
          subject = smapiClient.skills.delete(testData.skillId);
        });

        it('responds with no content', function() {
          subject = subject.then(function(response) {
            showResponse(response);
            return response;
          }, retry);
          return expect(subject).to.eventually.be.empty;
        });
      });
    });
  });
});
