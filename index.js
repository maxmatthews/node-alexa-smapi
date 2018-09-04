/* eslint-env node */
'use strict';

var axios = require('axios');

const BASE_URLS = {
  NA: 'https://api.amazonalexa.com',
  EU: 'https://api.eu.amazonalexa.com',
  FE: 'https://api.fe.amazonalexa.com'
};
const DEFAULT_GEO_REGION = 'NA';

const VERSION_0 = 'v0';
const VERSION_1 = 'v1';
const SUPPORTED_VERSIONS = [VERSION_0, VERSION_1];
const DEFAULT_VERSION = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];

function alexaSMAPI(params) {
  params = params !== undefined ? params : {};
  const version = SUPPORTED_VERSIONS.includes(params.version) ? params.version : DEFAULT_VERSION;
  var smapi = { BASE_URLS, version };

  var rest = {
    client: axios.create({
      baseURL: BASE_URLS[params.region in BASE_URLS ? params.region : DEFAULT_GEO_REGION],
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    }),
    head: function(url) {
      return this.client.head(url)
        .then(response => ({location: response.headers.location, etag: response.headers.etag}))
        .catch(response => Promise.reject(response.response));
    },
    get: function(url, parameters) {
      return this.client.get(url, { params: parameters !== undefined ? parameters : {} })
        .then(response => response.data)
        .catch(response => Promise.reject(response.response));
    },
    post: function(url, parameters) {
      return this.client.post(url, parameters !== undefined ? parameters : {})
        .then(response => Object.assign({}, {location: response.headers.location, etag: response.headers.etag}, response.data))
        .catch(response => Promise.reject(response.response));
    },
    put: function(url, parameters) {
      return this.client.put(url, parameters !== undefined ? parameters : {})
        .then(response => ({location: response.headers.location, etag: response.headers.etag}))
        .catch(response => Promise.reject(response.response));
    },
    delete: function(url) {
      return this.client.delete(url)
        .then(response => response.data)
        .catch(response => Promise.reject(response.response));
    }
  };

  smapi.refreshToken = (token) => {
    if (typeof token !== 'string' || token.length === 0)
      throw new Error('Invalid token specified!');
    else
      axios.defaults.headers.common['Authorization'] = token; // go back to rest.client... over axios... once can figure out why it was not working
  };

  smapi.setBaseUrl = (url) => {
    if (typeof url !== 'string' || url.length === 0)
      throw new Error('Invalid base url specified!');
    else
      axios.defaults.baseURL = url; // go back to rest.client... over axios... once can figure out why it was not working
  };

  smapi.tokens = {
    refresh: (params) => {
      return axios({
        baseURL: 'https://api.amazon.com',
        url: '/auth/o2/token',
        method: 'post',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        data: {
          grant_type: 'refresh_token',
          refresh_token: params.refreshToken,
          client_id: params.clientId,
          client_secret: params.clientSecret,
        }
      })
        .then(response => {
          smapi.refreshToken(response.data.access_token);
          return response.data; // could do some fancy work to "auto-refresh" token based on timestamp
        })
        .catch(response => Promise.reject(response.response));
    }
  };

  smapi.skills = {
    getManifest: (skillId, stage) => {
      const url = {
        v0: `/v0/skills/${skillId}`,
        v1: `/v1/skills/${skillId}/stages/${stage}/manifest`
      };
      return rest.get(url[smapi.version]);
    },
    create: (vendorId, skillManifest) => {
      if (smapi.version === VERSION_0) {
        return rest.post('/v0/skills', { vendorId, skillManifest });
      } else if (smapi.version === VERSION_1) {
        return rest.post('/v1/skills', { vendorId, manifest: skillManifest });
      }
    },
    update: (skillId, stage, skillManifest) => {
      if (smapi.version === VERSION_0) {
        skillManifest = stage;
        return rest.put(`/v0/skills/${skillId}`, { skillManifest });
      } else if (smapi.version === VERSION_1) {
        return rest.put(`/v1/skills/${skillId}/stages/${stage}/manifest`, { manifest: skillManifest });
      }
    },
    status: skillId => rest.get(`/${smapi.version}/skills/${skillId}/status`),
    list: (vendorId, maxResults, nextToken) => rest.get(`/${smapi.version}/skills`, { vendorId, maxResults, nextToken }),
    delete: skillId => rest.delete(`/${smapi.version}/skills/${skillId}`)
  };

  smapi.interactionModel = {
    get: (skillId, stage, locale) => {
      if (smapi.version === VERSION_0) locale = stage;
      const url = {
        v0: `/v0/skills/${skillId}/interactionModel/locales/${locale}`,
        v1: `/v1/skills/${skillId}/stages/${stage}/interactionModel/locales/${locale}`
      };
      return rest.get(url[smapi.version]);
    },
    getEtag: (skillId, stage, locale) => {
      if (smapi.version === VERSION_0) locale = stage;
      const url = {
        v0: `/v0/skills/${skillId}/interactionModel/locales/${locale}`,
        v1: `/v1/skills/${skillId}/stages/${stage}/interactionModel/locales/${locale}`
      };
      return rest.head(url[smapi.version]);
    },
    update: (skillId, stage, locale, interactionModel) => {
      if (smapi.version === VERSION_0) {
        interactionModel = locale;
        locale = stage;
        return rest.post(`/v0/skills/${skillId}/interactionModel/locales/${locale}`, { interactionModel });
      } else if (smapi.version === VERSION_1)
        return rest.put(`/v1/skills/${skillId}/stages/${stage}/interactionModel/locales/${locale}`, { interactionModel });
    },
    getStatus: (skillId, locale) => {
      const url = {
        v0: `/v0/skills/${skillId}/interactionModel/locales/${locale}/status`,
        v1: `/v1/skills/${skillId}/status?resource=interactionModel`
      };
      return rest.get(url[smapi.version]);
    }
  };

  smapi.accountLinking = {
    update: (skillId, stage, accountLinkingRequest) => {
      if (smapi.version === VERSION_0) accountLinkingRequest = stage;
      const url = {
        v0: `/v0/skills/${skillId}/accountLinkingClient`,
        v1: `/v1/skills/${skillId}/stages/${stage}/accountLinkingClient`
      };
      return rest.put(url[smapi.version], { accountLinkingRequest });
    },
    readInfo: (skillId, stage) => {
      const url = {
        v0: `/v0/skills/${skillId}/accountLinkingClient`,
        v1: `/v1/skills/${skillId}/stages/${stage}/accountLinkingClient`
      };
      return rest.get(url[smapi.version]);
    },
    delete: (skillId, stage) => rest.delete(`/v1/skills/${skillId}/stages/${stage}/accountLinkingClient`),
  };

  smapi.vendors = {
    list: () => rest.get(`/${smapi.version}/vendors`)
  };

  smapi.skillEnablement = {
    enable: (skillId, stage) => rest.put(`/v1/skills/${skillId}/stages/${stage}/enablement`),
    status: (skillId, stage) => rest.get(`/v1/skills/${skillId}/stages/${stage}/enablement`),
    disable: (skillId, stage) => rest.delete(`/v1/skills/${skillId}/stages/${stage}/enablement`)
  };

  smapi.skillCertification = {
    submit: skillId => rest.post(`/${smapi.version}/skills/${skillId}/submit`),
    status: (vendorId, skillId) => rest.get('/v1/skills', { vendorId, skillId }), // Trial and error as it is not properly documented at https://developer.amazon.com/docs/smapi/skill-certification-operations.html
    withdraw: (skillId, reason, message) => rest.post(`/${smapi.version}/skills/${skillId}/withdraw`, { reason, message })
  };

  smapi.skillTesting = {
    validate: (skillId, stage, locales) => rest.post(`/v1/skills/${skillId}/stages/${stage}/validations`, { locales }),
    validationStatus: (skillId, stage, validationId) => rest.get(`/v1/skills/${skillId}/stages/${stage}/validations/${validationId}`),
    invoke: (skillId, endpointRegion, skillRequest) => rest.post(`/${smapi.version}/skills/${skillId}/invocations`, { endpointRegion, skillRequest }),
    simulate: (skillId, content, locale) => rest.post(`/${smapi.version}/skills/${skillId}/simulations`, { input: { content }, device: { locale } }),
    simulationStatus: (skillId, requestId) => rest.get(`/${smapi.version}/skills/${skillId}/simulations/${requestId}`)
  };

  smapi.intentRequests = {
    list: (params) => {
      const skillId = params.skillId;
      delete params.skillId;
      return rest.get(`/v1/skills/${skillId}/history/intentRequests`, params);
    }
  };

  smapi.custom = {
    head: url => rest.head(url),
    get: (url, parameters) => rest.get(url, parameters),
    post: (url, parameters) => rest.post(url, parameters),
    put: (url, parameters) => rest.put(url, parameters),
    delete: url => rest.delete(url)
  };

  return smapi;
}

module.exports = alexaSMAPI;
