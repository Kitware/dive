# -*- coding: utf-8 -*-
import os

from setuptools import find_packages, setup


def prerelease_local_scheme(version):
    """Return local scheme version unless building on master in CircleCI.
    This function returns the local scheme version number
    (e.g. 0.0.0.dev<N>+g<HASH>) unless building on CircleCI for a
    pre-release in which case it ignores the hash and produces a
    PEP440 compliant pre-release version number (e.g. 0.0.0.dev<N>).
    """
    from setuptools_scm.version import get_local_node_and_date

    if os.getenv('CIRCLE_BRANCH') == 'master':
        return ''
    else:
        return get_local_node_and_date(version)

installReqs = [
    'cheroot>=8.4.5',
    'click=^8.1.3',
    'girder=3.1.14',
    'girder_jobs=3.1.14',
    'girder_worker=0.8.1',
    'girder_worker_utils0.8.7',
    'pydantic=1.9.0',
    'pyrabbit2=1.0.7',
    'typing-extensions=^4.2.0',
    'GPUtil=^1.4.0',
    'requests=>=2.27.1'
    'urllib3=<1.27'
]
# perform the install
setup(
    name='girder-dive-server',
    use_scm_version={'root': '../..', 'local_scheme': prerelease_local_scheme},
    setup_requires=['setuptools-scm', 'setuptools-git'],
    description='A Girder Plugin for Storing Annotation data and using VIAME Algorithms',
    author='Kitware, Inc.',
    author_email='kitware@kitware.com',
    url='https://kitware.github.io/dive/',
    license='Apache 2.0',
    classifiers=[
        'Development Status :: 5 - Production/Stable',
        'Environment :: Web Environment',
        'License :: OSI Approved :: Apache Software License',
        'Operating System :: OS Independent',
        'Programming Language :: Python',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.9',
    ],
    include_package_data=True,
    python_requires='>=3.8',
    packages=find_packages(exclude=['rabbitmq_user_queues', 'bucket_notifications', 'tests', 'scripts']),
    zip_safe=False,
    install_requires=installReqs,
    entry_points={
        'girder.plugin': [
            'dive_server = dive_server:DIVEPlugin'
        ]
    }
)