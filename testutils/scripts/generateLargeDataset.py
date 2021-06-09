import argparse
import json
import os
from PIL import Image
from tqdm import tqdm
import random

def create_track_json(directory,image_count, track_count, type_count=10, max_track_length=1,):
    """
    Read in JSON file and video file and extract bounds and create files for all the other data
    """
    types = []
    for type in range(type_count):
        types.append(f'Type_{type}')
    tracks = {}
    for track in tqdm(range(track_count)):

        track_obj ={
            'trackId': track,
            'begin': float('inf'),
            'end': float('-inf'),
            'confidencePairs': [[types[random.randint(0, type_count-1)], random.randint(0,100)/100.0]],
            'features': []
        }
        start_frame = random.randint(0, image_count-1)
        adjusted_max_track_length = max_track_length
        if image_count - start_frame < max_track_length:
            adjusted_max_track_length = image_count - start_frame
        if (adjusted_max_track_length > 1):
            track_length = random.randint(1, adjusted_max_track_length)
        else:
            track_length = adjusted_max_track_length
        for frame in range(track_length):
            frame = start_frame + frame
            feature = {
                'frame': frame,
                'keyframe': True,
                'bounds': [0,0,1,1],
            }
            track_obj['begin'] = min(track_obj['begin'], frame)
            track_obj['end'] = max(track_obj['end'], frame)
            track_obj["features"].append(feature)
        tracks[track] = track_obj
    json_file = f"{directory}/result_test.json"
    with open(json_file, 'w') as outfile:
        json.dump(tracks, outfile)

def create_images(directory, number):
    # Create a folder to hold it
    os.mkdir(directory)
    for index in tqdm(range(number)):
        img = Image.new("RGB", (1, 1))
        img.save(f'{directory}/image_{index}.jpg')

def main(args):
    create_images(args.directory, int(args.images))
    create_track_json(args.directory, int(args.images), int(args.tracks), int(args.types), int(args.track_length))


def parse_args():
    parser = argparse.ArgumentParser(description='Create Large Dataset')

    parser.add_argument('--images', default=100, help='Number of Images')
    parser.add_argument('--tracks', default=100, help='Number of Tracks')
    parser.add_argument('--types', default=10, help='Number of Types')
    parser.add_argument('--track_length', default=1, help='Max Track Length')
    parser.add_argument('--directory', default="./dataset", help='outputDirectory')

    return parser.parse_args()


if __name__ == '__main__':
    args = parse_args()
    main(args)
