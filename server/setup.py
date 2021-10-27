#!/usr/bin/env python
# -*- coding: utf-8 -*-

from setuptools import find_packages, setup

requirements = [
    "cheroot>=8.4.5",  # https://github.com/cherrypy/cheroot/issues/312
    "click>=8.0.0",
    "girder==3.1.5.dev8",
    "diva-boiler",
    "girder_jobs==3.0.3",
    "girder_worker==0.8.1",
    "girder_worker_utils==0.8.5",
    "pydantic==1.8.2",
    "pyrabbit2==1.0.7",  # For rabbitmq_user_queues plugin
    "typing_extensions",
    "gputil",
    # botocore requirement conflict
    "requests>=2.20.0",  # Match girder_worker_utils
    "urllib3<1.26",
]

dev_requirements = [
    "numpy",
    "opencv-python",
    "pytest",
    "tox",
]

setup(
    name="dive_server",
    version="1.0.0",
    description="DIVE Data Server",
    author='Kitware, Inc.',
    author_email="viame-web@kitware.com",
    url="https://github.com/Kitware/dive",
    license="Apache 2.0",
    keywords="DIVE, VIAME, VIAME-Web, Annotation",
    classifiers=[
        "License :: OSI Approved :: Apache Software License",
        "Natural Language :: English",
        "Programming Language :: Python",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
    ],
    python_requires=">=3.7",
    packages=find_packages(exclude=["tests", "tests.*"]),
    package_data={
        "": ["**/*.mako"],
    },
    zip_safe=False,
    entry_points={
        "console_scripts": ["dive=scripts.entrypoint_dev:cli"],
        "girder.plugin": [
            "dive_server = dive_server:GirderPlugin",
            "bucket_notifications = bucket_notifications:GirderPlugin",
            "rabbit_user_queues = rabbitmq_user_queues:GirderPlugin",
        ],
        "girder_worker_plugins": ["dive_tasks = dive_tasks:DIVEPlugin"],
    },
    install_requires=requirements,
    extras_require={"dev": dev_requirements},
)
