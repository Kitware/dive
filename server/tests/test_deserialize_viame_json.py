from dive_utils.serializers import viame


def test_load_json_as_track_and_attributes_without_track_attributes():
    json_data = {
        'version': 2,
        'fps': 30,
        'tracks': {
            '0': {
                'id': 0,
                'confidencePairs': [['fish', 1.0]],
                'begin': 0,
                'end': 1,
                'features': [
                    {
                        'frame': 0,
                        'bounds': [0, 0, 10, 10],
                    }
                ],
            }
        },
        'groups': {},
    }

    annotations, attributes = viame.load_json_as_track_and_attributes(json_data)

    assert annotations == json_data
    assert attributes == {}
