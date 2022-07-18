#!/bin/bash
# sets up the IVIS python package
python3 -m pip install --user --upgrade setuptools wheel
(cd "./setup/jobs/python/ivis" && python3 setup.py sdist bdist_wheel)