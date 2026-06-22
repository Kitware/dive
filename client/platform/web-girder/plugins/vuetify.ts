import createDiveVuetify from 'dive-common/vuetify/createDiveVuetify';

function getVuetify(config: Record<string, unknown> | null | undefined = undefined) {
  return createDiveVuetify(config);
}

export default getVuetify;
