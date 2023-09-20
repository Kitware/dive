from setuptools import setup

setup(
    name='ascent',
    version='0.1.0',
    py_modules=['ascent'],
    install_requires=['click', 'pathlib'],
    entry_points={
        'console_scripts': [
            'ascent = ascent.cli:ascent'
        ]
    }
)
