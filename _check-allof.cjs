const SwaggerParser = require('@apidevtools/swagger-parser');

const spec = {
  openapi: '3.0.0',
  info: { title: 'Test', version: '1.0' },
  paths: {
    '/api/test': {
      post: {
        description: 'test allOf',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
                  { type: 'object', properties: { age: { type: 'integer' } } }
                ]
              }
            }
          }
        }
      }
    }
  }
};

SwaggerParser.dereference(spec).then(result => {
  const schema = result.paths['/api/test'].post.requestBody.content['application/json'].schema;
  console.log('Has allOf:', !!schema.allOf);
  console.log('Has properties:', !!schema.properties);
  console.log(JSON.stringify(schema, null, 2));
});
