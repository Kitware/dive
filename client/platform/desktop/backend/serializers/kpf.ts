/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DIVA KPF parser
 *
 * This parser is an example for how to turn a domain-specific annotation schema
 * like DIVA KPF into DIVE Json.
 */

import yaml from 'js-yaml';
import fs from 'fs-extra';
import { AnnotationFileData } from 'platform/desktop/backend/serializers/viame';
import { Feature } from 'vue-media-annotator/track';
import { ConfidencePair, StringKeyObject } from 'vue-media-annotator/BaseAnnotation';
import { MultiGroupRecord, MultiTrackRecord } from 'dive-common/apispec';
import { flattenDeep, uniqBy } from 'lodash';
import { GroupMembers } from 'vue-media-annotator/Group';

export const KPF_EXTENSIONS = ['activities.yml', 'geom.yml', 'types.yml'];

const GEOM_ACTOR_KEY = 'id1';
const TIME_FRAMES_KEY = 'ts0';
const GEOM_BBOX_KEY = 'g0';

interface KPFType {
  cset3: Record<string, number>;
  id1: number;
}

interface KPFGeom {
  g0: string;
  id0: number;
  id1: number;
  keyframe: boolean;
  ts0: number;
}

interface KPFTimespan {
  tsr0: [number, number];
}

interface KPFActor {
  id1: number;
  timespan: KPFTimespan[];
}

interface KPFActivity {
  id2: number;
  src_status: string;
  act2: Record<string, number>;
  actors: KPFActor[];
  timespan: KPFTimespan[];
}

/**
* KPF Class parses annotations defined in KPF yaml format.
*/
export default class KPF {
  activities: KPFActivity[];

  geom: KPFGeom[];

  types: KPFType[];

  actorType: Record<string, KPFType>;

  meta: Record<string, any>;

  actorGeom: Record<string, KPFGeom[]>;

  actorActivity: Record<string, KPFActivity[]>;

  constructor(
    activities: KPFActivity[] = [],
    geom: KPFGeom[] = [],
    types: KPFType[] = [],
    meta = {},
  ) {
    this.activities = activities;
    this.geom = geom;
    this.types = types;
    this.actorType = {};
    this.actorGeom = {};
    this.actorActivity = {};
    this.meta = meta;
    this.postProcess();
  }

  postProcess() {
    this.types = KPF.filterEmpty(this.types, [GEOM_ACTOR_KEY]);
    this.geom = KPF.filterEmpty(this.geom, [GEOM_ACTOR_KEY, GEOM_BBOX_KEY, TIME_FRAMES_KEY]);
    this.activities = KPF.filterEmpty(this.activities, ['act2']);

    this.types.forEach((t) => {
      const actorId = t[GEOM_ACTOR_KEY];
      this.actorType[actorId] = t;
    });

    this.geom.forEach((g) => {
      const actorId = g[GEOM_ACTOR_KEY];
      if (actorId in this.actorGeom) {
        this.actorGeom[actorId].push(g);
      } else {
        this.actorGeom[actorId] = [g];
      }
    });

    this.activities.forEach((act) => {
      act.actors.forEach((actor) => {
        const actorId = actor.id1;
        if (actorId in this.actorActivity) {
          this.actorActivity[actorId].push(act);
        } else {
          this.actorActivity[actorId] = [act];
        }
      });
    });
  }

  /**
  * Turn KPF into DIVE Json
  * @param {Object} staticMeta static metadata to assign to all tracks.
  * @returns {Array<tdm.Track>}
  */
  getJson(keyframesOnly = true): AnnotationFileData {
    const tracks: MultiTrackRecord = {};
    const groups: MultiGroupRecord = {};

    Object.keys(this.actorGeom).forEach((actorIdStr) => {
      const activity = this.actorActivity[actorIdStr];
      const actorType = this.actorType[actorIdStr];
      const attributes: StringKeyObject = {
        activityIds: activity.map((a) => a.id2).join(' '),
        srcStatus: activity.map((a) => a.src_status).join(' '),
      };
      const activityActor = flattenDeep(
        activity.map((v) => v.actors.filter((a) => a.id1 === actorType.id1)),
      );
      const allRanges = flattenDeep(
        activityActor.map((v) => v.timespan.map((ts) => ts.tsr0)),
      );
      const begin = Math.min(...allRanges);
      const end = Math.max(...allRanges);
      const features: Feature[] = [];
      const confidencePairs: ConfidencePair[] = Object.entries(actorType.cset3);
      Object.values(this.actorGeom[actorIdStr]).forEach((geom) => {
        if ((geom.keyframe && keyframesOnly) || !keyframesOnly) {
          features.push({
            frame: geom.ts0,
            attributes: {},
            // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
            // @ts-ignore
            bounds: geom.g0.split(' ').map((f: string) => parseFloat(f)),
            interpolate: true,
          });
        }
      });

      tracks[actorType.id1] = {
        attributes,
        id: actorType.id1,
        begin,
        end,
        confidencePairs,
        features: uniqBy(features.sort((a, b) => a.frame - b.frame), 'frame'),
      };
    });

    this.activities.forEach((activity) => {
      const allRanges = flattenDeep(activity.timespan.map((v) => v.tsr0));
      const confidencePairs: ConfidencePair[] = Object.entries(activity.act2);
      const begin = Math.min(...allRanges);
      const end = Math.max(...allRanges);
      const members: GroupMembers = {};
      activity.actors.forEach((actor) => {
        members[actor.id1] = {
          ranges: actor.timespan.map((t) => t.tsr0),
        };
      });
      groups[activity.id2] = {
        begin,
        end,
        members,
        id: activity.id2,
        confidencePairs,
        attributes: {},
      };
    });

    return {
      tracks,
      groups,
    };
  }

  /**
  * Return elements of list that have validKey defined
  * @param {Array} list
  * @param {String} validKey
  */
  static filterEmpty(list: any[], validKeyList: string[]) {
    return list.filter((l) => validKeyList.some((e) => e in l));
  }

  /**
  * Return elements where number key in range value
  */
  static filterRange(list: any[], key: string, lower: number, upper: number) {
    return list.filter((item) => item[key] <= upper && item[key] >= lower);
  }

  /**
  * Create KPF object from YAML text strings.
  * @param {String} activityText
  * @param {String} geometryText
  */
  static fromText(activityText: string, geometryText: string, typeText: string) {
    const activityJson = (yaml.load(activityText) as any[]).map((a) => ({ ...a.act }));
    const geometryJson = (yaml.load(geometryText) as any[]).map((g) => ({ ...g.geom }));
    const typeJson = (yaml.load(typeText) as any[]).map((t) => ({ ...t.types }));
    return new KPF(activityJson, geometryJson, typeJson);
  }

  static async parse(
    activityFile: string, geometryFile: string, typeFile: string,
  ) {
    const promiseList = [];
    promiseList.push(fs.readFile(geometryFile, 'utf8'));
    promiseList.push(fs.readFile(typeFile, 'utf8'));
    promiseList.push(fs.readFile(activityFile, 'utf8'));
    const [geometryText, typeText, activityText] = await Promise.all(promiseList);
    const kpf = KPF.fromText(activityText, geometryText, typeText);
    return kpf.getJson();
  }
}
