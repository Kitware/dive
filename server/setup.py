#!/usr/bin/env python
# -*- coding: utf-8 -*-

from setuptools import find_packages, setup

requirements = [
    "cheroot>=8.4.5",  # https://github.com/cherrypy/cheroot/issues/312
    "girder==3.1.0",
    "diva-boiler",
    "girder_jobs==3.0.3",
    "girder_worker==0.8.0",
    "girder_worker_utils==0.8.5",
    "pydantic",
    "pysnooper",
    "typing_extensions",
    "gputil",
    # botocore requirement conflict
    "urllib3<1.26",
]

setup(
    author_email="viame-web@kitware.com",
    classifiers=[
        "License :: OSI Approved :: Apache Software License",
        "Natural Language :: English",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.6",
    ],
    description="DIVE Data Server",
    install_requires=requirements,
    python_requires=">=3.7",
    license="Apache Software License 2.0",
    include_package_data=True,
    keywords="DIVE, VIAME, VIAME-Web, Annotation",
    name="dive_server",
    packages=find_packages(exclude=["test", "test.*"]),
    url="https://github.com/Kitware/dive",
    version="1.4.1",
    zip_safe=False,
    entry_points={
        "girder.plugin": ["dive_server = dive_server:GirderPlugin"],
        "girder_worker_plugins": ["dive_tasks = dive_tasks:DIVEPlugin"],
    },
)
